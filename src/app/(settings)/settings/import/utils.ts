import { authFetch } from "@/lib/auth/client";
import type {
	ComposioAccountSummary,
	ComposioAccountsResponse,
	ComposioFormState,
	GmailLabelOption,
	GmailLabelsResponse,
	ImapFormState,
	ImportFolderSummary,
	ImportResult,
	ImportSourceItem,
	ImportSourceOption,
	ImportSourceSection,
	LinkedAccountSummary,
	LinkedAccountsResponse,
} from "./types";

export const importSourceOptions: ImportSourceOption[] = [
	{ value: "inbox", label: "Inbox", imapFolder: "INBOX", destination: "system:inbox", system: true },
	{ value: "sent", label: "Sent", imapFolder: "Sent", destination: "system:sent", system: true },
	{ value: "drafts", label: "Drafts", imapFolder: "Drafts", destination: "system:drafts", system: true },
	{ value: "archived", label: "Archived", imapFolder: "Archive", destination: "system:archived", system: true },
	{ value: "spam", label: "Spam", imapFolder: "Spam", destination: "system:spam", system: true },
	{ value: "trash", label: "Trash", imapFolder: "Trash", destination: "system:trash", system: true },
	{ value: "others", label: "Others", imapFolder: "", destination: "system:inbox" },
];

export function getImportSourceOption(section: ImportSourceSection): ImportSourceOption {
	return importSourceOptions.find((option) => option.value === section) ?? importSourceOptions[0];
}

export function getSelectedImportSources(sections: ImportSourceSection[]): ImportSourceItem[] {
	return sections.map((section) => {
		const option = getImportSourceOption(section);
		return {
			id: `system:${option.value}`,
			label: option.label,
			imapFolder: option.imapFolder,
			destination: option.destination,
			sourceSection: option.value,
		};
	});
}

export function getFolderImportSource(folderName: string): ImportSourceItem {
	return {
		id: `folder:${folderName}`,
		label: folderName,
		imapFolder: folderName,
		destination: "",
		folderName,
	};
}

export function resolveImapSourceFolder(source: ImportSourceItem, folders: string[]): string {
	if (!source.sourceSection || source.sourceSection === "others") return source.imapFolder;
	const match = findFolderMatch(folders, getFolderAliases(source.sourceSection));
	return match ?? source.imapFolder;
}

export function filterCustomImapFolders(folders: string[], selectedSources: ImportSourceItem[]): string[] {
	const systemAliases = new Set(
		(["inbox", "sent", "drafts", "archived", "spam", "trash"] as ImportSourceSection[])
			.flatMap(getFolderAliases)
			.map(normalizeFolderName),
	);
	for (const source of selectedSources) {
		const folder = resolveImapSourceFolder(source, folders);
		if (folder) systemAliases.add(normalizeFolderName(folder));
	}
	return folders.filter((folder) => !systemAliases.has(normalizeFolderName(folder)));
}

export function getFileImportSource(sources: ImportSourceItem[]): ImportSourceItem {
	return sources.find((source) => source.id !== "system:others") ?? getSelectedImportSources(["inbox"])[0];
}

export const composioSystemDestinations = [
	{ value: "system:inbox", label: "Inbox" },
	{ value: "system:archived", label: "Archived" },
	{ value: "system:spam", label: "Spam" },
	{ value: "system:trash", label: "Trash" },
];

export const COMPOSIO_NEW_FOLDER = "new-folder";

/** Maps a Gmail label to its Gmail search query equivalent. */
export function getGmailLabelQuery(label: { id: string; name: string; type: "system" | "user" }): string {
	if (label.type === "user") return `label:"${label.name.replace(/"/g, "")}"`;
	switch (label.id) {
		case "INBOX": return "in:inbox";
		case "SENT": return "in:sent";
		case "SPAM": return "in:spam";
		case "TRASH": return "in:trash";
		case "STARRED": return "is:starred";
		case "UNREAD": return "is:unread";
		case "IMPORTANT": return "is:important";
		default:
			if (label.id.startsWith("CATEGORY_")) {
				return `category:${label.id.slice("CATEGORY_".length).toLowerCase()}`;
			}
			return `label:${label.id.toLowerCase()}`;
	}
}

/** Friendly display names for Gmail's system labels. */
export function getGmailLabelDisplayName(label: { id: string; name: string; type: "system" | "user" }): string {
	const names: Record<string, string> = {
		INBOX: "Inbox",
		SENT: "Sent",
		SPAM: "Spam",
		TRASH: "Trash",
		DRAFT: "Drafts",
		STARRED: "Starred",
		UNREAD: "Unread",
		IMPORTANT: "Important",
		CHAT: "Chat",
		CATEGORY_FORUMS: "Forums",
		CATEGORY_UPDATES: "Updates",
		CATEGORY_PERSONAL: "Personal",
		CATEGORY_PROMOTIONS: "Promotions",
		CATEGORY_SOCIAL: "Social",
	};
	if (label.type === "user") return label.name;
	return names[label.id] ?? label.id;
}

export async function fetchGmailLabels(connectedAccountId: string): Promise<GmailLabelOption[]> {
	const params = new URLSearchParams({ connectedAccountId });
	const response = await authFetch(`/api/import/composio/labels?${params.toString()}`);
	const data = (await response.json()) as GmailLabelsResponse;
	if (!response.ok) throw new Error(data.error ?? "Unable to list Gmail labels");
	return data.labels ?? [];
}

export function getComposioDestinationLabel(
	destination: string,
	folders: ImportFolderSummary[],
): string {
	if (destination === COMPOSIO_NEW_FOLDER) return "New folder";
	if (destination.startsWith("folder:")) {
		const folderId = destination.slice("folder:".length);
		return folders.find((folder) => folder.id === folderId)?.name ?? "Custom folder";
	}
	return composioSystemDestinations.find((item) => item.value === destination)?.label ?? "Inbox";
}

export async function listMailboxFolders(mailboxId: string): Promise<ImportFolderSummary[]> {
	return fetchMailboxFolders(mailboxId);
}

export async function ensureFolder(mailboxId: string, name: string): Promise<string> {
	const folders = await fetchMailboxFolders(mailboxId);
	const existing = folders.find((folder) => folder.name.toLowerCase() === name.toLowerCase());
	if (existing) return `folder:${existing.id}`;

	const response = await authFetch("/api/folders", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ mailboxId, name }),
	});
	const data = (await response.json()) as ImportFolderSummary & { error?: string };
	if (!response.ok) throw new Error(data.error ?? `Unable to create folder ${name}`);
	return `folder:${data.id}`;
}

export async function resolveComposioDestination(
	mailboxId: string,
	form: ComposioFormState,
): Promise<string> {
	if (form.destination !== COMPOSIO_NEW_FOLDER) return form.destination || "system:inbox";
	const name = form.newFolderName.trim();
	if (!name) throw new Error("New folder name is required");
	return ensureFolder(mailboxId, name);
}

export async function ensureImportDestination(
	mailboxId: string,
	source: ImportSourceItem,
): Promise<string> {
	if (!source.folderName) return source.destination;
	return ensureFolder(mailboxId, source.folderName);
}

async function fetchMailboxFolders(mailboxId: string): Promise<ImportFolderSummary[]> {
	const params = new URLSearchParams({ mailboxId });
	const response = await authFetch(`/api/folders?${params.toString()}`);
	const data = (await response.json()) as { folders?: ImportFolderSummary[]; error?: string };
	if (!response.ok) throw new Error(data.error ?? "Unable to load folders");
	return data.folders ?? [];
}

export async function importFromImap(
	mailboxId: string,
	form: ImapFormState,
	destination: string,
): Promise<ImportResult> {
	const response = await authFetch("/api/import/imap", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			mailboxId,
			destination,
			host: form.host,
			port: Number(form.port),
			secure: form.secure,
			username: form.username,
			password: form.password,
			folder: form.folder,
			limit: Number(form.limit),
		}),
	});
	const data = (await response.json()) as ImportResult;
	if (!response.ok) throw new Error(data.error ?? "IMAP import failed");
	return data;
}

export async function fetchImapFolders(form: ImapFormState): Promise<string[]> {
	const response = await authFetch("/api/import/imap/folders", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			host: form.host,
			port: Number(form.port),
			secure: form.secure,
			username: form.username,
			password: form.password,
		}),
	});
	const data = (await response.json()) as { folders?: string[]; error?: string };
	if (!response.ok) throw new Error(data.error ?? "Unable to list IMAP folders");
	return data.folders ?? [];
}

export async function fetchComposioAccounts(): Promise<ComposioAccountSummary[]> {
	const response = await authFetch("/api/import/composio/accounts");
	const data = (await response.json()) as ComposioAccountsResponse;
	if (!response.ok) throw new Error(data.error ?? "Unable to load Composio accounts");
	return data.accounts ?? [];
}

export async function importFromComposio(
	mailboxId: string,
	form: ComposioFormState,
	destination: string,
): Promise<ImportResult> {
	const response = await authFetch("/api/import/composio", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			mailboxId,
			destination,
			connectedAccountId: form.connectedAccountId,
			query: form.query,
			limit: Number(form.limit || 25),
		}),
	});
	const data = (await response.json()) as ImportResult;
	if (!response.ok) throw new Error(data.error ?? "Composio import failed");
	return data;
}

export async function fetchLinkedAccounts(): Promise<{ accounts: LinkedAccountSummary[]; configured: boolean }> {
	const response = await authFetch("/api/linked-accounts");
	const data = (await response.json()) as LinkedAccountsResponse;
	if (!response.ok) throw new Error(data.error ?? "Unable to load linked accounts");
	return { accounts: data.accounts ?? [], configured: data.configured ?? false };
}

export async function createLinkedAccount(
	mailboxId: string,
	form: ComposioFormState,
	destination: string,
): Promise<{ id: string }> {
	const response = await authFetch("/api/linked-accounts", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			mailboxId,
			destination,
			connectedAccountId: form.connectedAccountId,
		}),
	});
	const data = (await response.json()) as { id?: string; error?: string };
	if (!response.ok) throw new Error(data.error ?? "Unable to link the account");
	return { id: data.id ?? "" };
}

export function formatImportResult(result: ImportResult | null): string {
	if (!result) return "";
	return `${result.imported ?? 0} imported, ${result.skipped ?? 0} skipped`;
}

function findFolderMatch(folders: string[], aliases: string[]): string | null {
	const normalizedAliases = aliases.map(normalizeFolderName);
	return folders.find((folder) => normalizedAliases.includes(normalizeFolderName(folder))) ?? null;
}

function getFolderAliases(section: ImportSourceSection): string[] {
	if (section === "inbox") return ["INBOX", "Inbox"];
	if (section === "sent") return ["Sent", "Sent Mail", "[Gmail]/Sent Mail", "Sent Items"];
	if (section === "drafts") return ["Drafts", "[Gmail]/Drafts"];
	if (section === "archived") return ["Archive", "Archived", "[Gmail]/All Mail"];
	if (section === "spam") return ["Spam", "Junk", "Junk Email", "[Gmail]/Spam"];
	if (section === "trash") return ["Trash", "Deleted", "Deleted Items", "[Gmail]/Trash"];
	return [];
}

function normalizeFolderName(value: string): string {
	return value.toLowerCase().replace(/^\[gmail\]\//, "").replace(/\s+/g, " ").trim();
}
