import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { folders, linkedAccounts } from "@/db/schema";
import { parseImportDestination } from "@/lib/import/destination";
import type { ImportDestination } from "@/lib/import/destination-types";
import { importMessagesToMailbox } from "@/lib/import/service";
import {
	ComposioError,
	composioProxy,
	decodeGmailBase64Url,
	fetchGmailProfile,
	fetchGmailRawMessage,
} from "./client";

const GMAIL_API_BASE_URL = "https://gmail.googleapis.com";
/** Caps per-account work so one cron tick stays well inside Worker limits. */
const SYNC_MAX_MESSAGES = 25;
const SYNC_MAX_HISTORY_PAGES = 5;

export type GmailSyncAccountResult = {
	accountId: string;
	emailAddress: string | null;
	imported: number;
	skipped: number;
	baselined?: boolean;
	error?: string;
};

/**
 * Pulls new Gmail mail for every enabled linked account.
 *
 * The first run stores the account's current Gmail historyId as a baseline
 * (importing nothing); later runs replay the History API changes since that
 * cursor. If Google expires the cursor (404), a new baseline is taken and the
 * backlog is skipped rather than replayed.
 */
export async function runGmailSync(env: CloudflareEnv): Promise<GmailSyncAccountResult[]> {
	if (!env.COMPOSIO_API_KEY) return [];
	const db = getDb(env);
	const accounts = await db.select().from(linkedAccounts).where(eq(linkedAccounts.enabled, true));
	const results: GmailSyncAccountResult[] = [];
	for (const account of accounts) {
		if (account.provider !== "gmail") continue;
		try {
			const outcome = await syncGmailAccount(env, db, account);
			results.push({
				accountId: account.id,
				emailAddress: account.emailAddress,
				...outcome,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "Sync failed";
			await db.update(linkedAccounts).set({ lastError: message }).where(eq(linkedAccounts.id, account.id));
			results.push({
				accountId: account.id,
				emailAddress: account.emailAddress,
				imported: 0,
				skipped: 0,
				error: message,
			});
		}
	}
	return results;
}

type SyncOutcome = Pick<GmailSyncAccountResult, "imported" | "skipped" | "baselined">;

async function syncGmailAccount(
	env: CloudflareEnv,
	db: ReturnType<typeof getDb>,
	account: typeof linkedAccounts.$inferSelect,
): Promise<SyncOutcome> {
	const destination = await resolveSyncDestination(db, account);
	const cursor = account.syncCursor?.trim();

	if (!cursor) {
		await baselineAccount(env, db, account);
		return { imported: 0, skipped: 0, baselined: true };
	}

	const changes = await listHistoryChanges(env, account.connectedAccountId, cursor);
	if (changes.expired) {
		await baselineAccount(env, db, account);
		return { imported: 0, skipped: 0, baselined: true };
	}

	let imported = 0;
	let skipped = 0;
	const pending = changes.messageIds.slice(0, SYNC_MAX_MESSAGES);
	if (pending.length) {
		const messages: { filename: string; raw: ArrayBuffer }[] = [];
		for (const messageId of pending) {
			try {
				const raw = await fetchGmailRawMessage(env, account.connectedAccountId, messageId);
				messages.push({ filename: `${messageId}.eml`, raw: decodeGmailBase64Url(raw.raw) });
			} catch {
				skipped += 1;
			}
		}
		if (messages.length) {
			const result = await importMessagesToMailbox(env, {
				userId: account.userId,
				mailboxId: account.mailboxId,
				destination,
				messages,
			});
			imported = result.imported;
			skipped += result.skipped;
		}
	}

	const nextCursor = changes.historyId ?? cursor;
	await db
		.update(linkedAccounts)
		.set({ syncCursor: nextCursor, lastSyncedAt: new Date(), lastError: null })
		.where(eq(linkedAccounts.id, account.id));
	return { imported, skipped };
}

async function baselineAccount(
	env: CloudflareEnv,
	db: ReturnType<typeof getDb>,
	account: typeof linkedAccounts.$inferSelect,
): Promise<void> {
	const profile = await fetchGmailProfile(env, account.connectedAccountId);
	await db
		.update(linkedAccounts)
		.set({ syncCursor: profile.historyId ?? null, lastSyncedAt: new Date(), lastError: null })
		.where(eq(linkedAccounts.id, account.id));
}

type HistoryChanges = {
	messageIds: string[];
	historyId: string | null;
	expired: boolean;
};

async function listHistoryChanges(
	env: CloudflareEnv,
	connectedAccountId: string,
	startHistoryId: string,
): Promise<HistoryChanges> {
	const messageIds = new Set<string>();
	let latestHistoryId: string | null = null;
	let pageToken: string | undefined;

	for (let page = 0; page < SYNC_MAX_HISTORY_PAGES; page += 1) {
		let data: {
			history?: { messagesAdded?: { message?: { id?: string; labelIds?: string[] } }[] }[];
			historyId?: string;
			nextPageToken?: string;
		};
		try {
			data = await fetchGmailHistoryPage(env, connectedAccountId, startHistoryId, pageToken);
		} catch (error) {
			if (error instanceof ComposioError && error.status === 404) {
				return { messageIds: [], historyId: null, expired: true };
			}
			throw error;
		}

		for (const record of data.history ?? []) {
			for (const added of record.messagesAdded ?? []) {
				const message = added.message;
				if (!message?.id) continue;
				const labels = message.labelIds ?? [];
				if (labels.includes("SPAM") || labels.includes("TRASH")) continue;
				messageIds.add(message.id);
			}
		}
		if (data.historyId) latestHistoryId = data.historyId;
		pageToken = data.nextPageToken;
		if (!pageToken) break;
	}

	return { messageIds: [...messageIds], historyId: latestHistoryId, expired: false };
}

function fetchGmailHistoryPage(
	env: CloudflareEnv,
	connectedAccountId: string,
	startHistoryId: string,
	pageToken?: string,
) {
	return composioProxy<{
		history?: { messagesAdded?: { message?: { id?: string; labelIds?: string[] } }[] }[];
		historyId?: string;
		nextPageToken?: string;
	}>(env, {
		connectedAccountId,
		method: "GET",
		endpoint: `${GMAIL_API_BASE_URL}/gmail/v1/users/me/history`,
		query: { startHistoryId, pageToken, maxResults: 500 },
	});
}

/** Falls back to the inbox when the linked destination folder no longer exists. */
async function resolveSyncDestination(
	db: ReturnType<typeof getDb>,
	account: typeof linkedAccounts.$inferSelect,
): Promise<ImportDestination> {
	try {
		const parsed = parseImportDestination(account.destination);
		if (parsed.type === "folder") {
			const [folder] = await db
				.select({ id: folders.id })
				.from(folders)
				.where(and(eq(folders.id, parsed.folderId), eq(folders.mailboxId, account.mailboxId)))
				.limit(1);
			if (!folder) return { type: "system", section: "inbox" };
		}
		return parsed;
	} catch {
		return { type: "system", section: "inbox" };
	}
}
