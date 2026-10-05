"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { ChevronUp, FileText, Forward, Maximize2, Minimize2, Minus, Paperclip, Reply, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { authFetch } from "@/lib/auth/client";
import { formatEmailAddress, getEmailAddress } from "@/lib/email/address";
import { cn } from "@/lib/utils";
import { SendReview } from "@/components/agent/send-review";
import type { ReviewSnapshot } from "@/components/agent/send-review-types";
import { buildSendFormData, fetchDraft, formatAttachmentSize } from "./utils";
import { RecipientInput } from "./recipient-input";
import { RichTextEditor } from "./rich-text-editor";
import { ScheduleSendMenu } from "./schedule-send-menu";
import {
	applyMailboxSignatureHtml,
	hasMeaningfulHtml,
	htmlToPlainText,
	joinQuotedHtml,
	splitQuotedHtml,
	textToHtml,
} from "./rich-text-utils";
import { headerToRecipients, isValidRecipient, recipientsToHeader } from "./recipient-utils";
import {
	draftAttachmentUrl,
	isImageFile,
	maybeDownscaleImage,
	resolveInlineImageSources,
	rewriteInlineImageSources,
	stripDeadInlineImages,
} from "./image-utils";
import type { ComposeAttachment, ComposeStoredAttachment, ComposeThreading } from "./types";
import type { ComposeAttachmentPolicy } from "./attachment-policy-types";

type Toast = { type: "success" | "error"; message: string } | null;

type InlineImageState = {
	file: File;
	src: string;
	attachmentId: string | null;
	contentId: string | null;
};

export function ComposeForm({
	mode = "page",
	draftIdToLoad,
	onClose,
}: {
	mode?: "page" | "popup";
	draftIdToLoad?: string | null;
	onClose?: () => void;
}) {
	const router = useRouter();
	const { selectedMailbox, setSelectedMailbox, mailboxes } = useSelectedMailbox();
	const [draftId, setDraftId] = useState<string | null>(null);
	const [agentRevision, setAgentRevision] = useState<number | null>(null);
	const [agentReview, setAgentReview] = useState<{ approvalId: string; snapshot: ReviewSnapshot } | null>(null);
	const [to, setTo] = useState<string[]>([]);
	const [cc, setCc] = useState<string[]>([]);
	const [bcc, setBcc] = useState<string[]>([]);
	const [showCc, setShowCc] = useState(false);
	const [showBcc, setShowBcc] = useState(false);
	const [threading, setThreading] = useState<ComposeThreading | null>(null);
	const [subject, setSubject] = useState("");
	// The body is HTML; quoted/forwarded content is kept aside and folded.
	const [html, setHtml] = useState("");
	const [quotedHtml, setQuotedHtml] = useState<string | null>(null);
	const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
	// Attachments the draft already holds server-side (a forwarded message's files).
	const [storedAttachments, setStoredAttachments] = useState<ComposeStoredAttachment[]>([]);
	// Inline attachments the body or quoted HTML references by cid.
	const [inlineStoredAttachments, setInlineStoredAttachments] = useState<Array<ComposeStoredAttachment & { contentId: string }>>([]);
	const [attachmentPolicy, setAttachmentPolicy] = useState<ComposeAttachmentPolicy>({ maxMb: 25, cloudThresholdBytes: 3_000_000 });
	const [draggingFiles, setDraggingFiles] = useState(false);
	const [modalMode, setModalMode] = useState(false);
	const [minimized, setMinimized] = useState(false);
	const [toast, setToast] = useState<Toast>(null);
	const [loading, setLoading] = useState(false);
	const [loadingDraft, setLoadingDraft] = useState(false);
	const [deletingDraft, setDeletingDraft] = useState(false);
	const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
	const [loadedDraftMailboxId, setLoadedDraftMailboxId] = useState<string | null>(null);
	const [loadedDraftFrom, setLoadedDraftFrom] = useState<string | null>(null);
	const [selectedFrom, setSelectedFrom] = useState("");
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const draftGeneration = useRef(0);
	const attachmentInput = useRef<HTMLInputElement | null>(null);
	const fileDragDepth = useRef(0);
	const previousSignature = useRef("");
	// Embedded body images. Kept in a ref because they render inside the HTML,
	// not as tray chips; the ref avoids re-render churn during uploads.
	const inlineImages = useRef<InlineImageState[]>([]);

	useEffect(() => {
		if (!selectedMailbox && mailboxes.length === 1) setSelectedMailbox(mailboxes[0]);
	}, [mailboxes, selectedMailbox, setSelectedMailbox]);

	useEffect(() => {
		let active = true;
		void authFetch("/api/attachment-policy", { cache: "no-store" }).then(async (response) => {
			if (response.ok && active) setAttachmentPolicy((await response.json()) as ComposeAttachmentPolicy);
		}).catch(() => {});
		return () => { active = false; };
	}, []);

	const senderAddresses = useMemo(() => {
		if (!selectedMailbox) return [];
		return selectedMailbox.senderAddresses?.length
			? selectedMailbox.senderAddresses
			: [`${selectedMailbox.localPart}@${selectedMailbox.hostname}`];
	}, [selectedMailbox]);
	const senderOptions = useMemo(
		() => mailboxes.flatMap((mailbox) => {
			const addresses = mailbox.senderAddresses?.length
				? mailbox.senderAddresses
				: [`${mailbox.localPart}@${mailbox.hostname}`];
			return addresses.map((address) => ({ mailbox, address }));
		}),
		[mailboxes],
	);
	const fromAddr = selectedMailbox && selectedFrom
		? formatEmailAddress(selectedFrom, selectedMailbox.displayName)
		: "";

	useEffect(() => {
		if (!senderAddresses.length) {
			setSelectedFrom("");
			return;
		}
		if (!senderAddresses.includes(selectedFrom)) setSelectedFrom(senderAddresses[0]);
	}, [selectedFrom, senderAddresses]);

	useEffect(() => {
		if (!toast) return;
		const timer = setTimeout(() => setToast(null), 3200);
		return () => clearTimeout(timer);
	}, [toast]);

	useEffect(() => {
		if (!draftIdToLoad) return;

		let cancelled = false;
		setLoadingDraft(true);
		fetchDraft(draftIdToLoad)
			.then((draft) => {
				if (cancelled) return;

				setDraftId(draft.id);
				setAgentRevision(draft.agent?.revision ?? null);
				setScheduledAt(draft.agent?.scheduledAt ? new Date(draft.agent.scheduledAt) : null);
				setTo(headerToRecipients(draft.toAddr));
				const draftCc = headerToRecipients(draft.ccAddr);
				const draftBcc = headerToRecipients(draft.bccAddr);
				setCc(draftCc);
				setBcc(draftBcc);
				setShowCc(draftCc.length > 0);
				setShowBcc(draftBcc.length > 0);
				setThreading(
					draft.inReplyTo || draft.threadId
						? {
							inReplyTo: draft.inReplyTo ?? null,
							references: draft.references ?? null,
							threadId: draft.threadId ?? null,
						}
						: null,
				);
				setSubject(draft.subject ?? "");
				const stored = splitQuotedHtml(draft.htmlBody || textToHtml(draft.textBody));
				const allAttachments = draft.attachments ?? [];
				const inlineStored = allAttachments.filter(
					(item): item is ComposeStoredAttachment & { contentId: string } =>
						item.disposition === "inline" && !!item.contentId,
				);
				const inlineSources = inlineStored.map((item) => ({
					src: draftAttachmentUrl(draft.id, item.id),
					contentId: item.contentId,
				}));
				setInlineStoredAttachments(inlineStored);
				setHtml(stripDeadInlineImages(resolveInlineImageSources(stored.body, inlineSources)));
				setQuotedHtml(stored.quoted ? resolveInlineImageSources(stored.quoted, inlineSources) : null);
				setStoredAttachments(allAttachments.filter((item) => item.disposition === "attachment"));
				setLoadedDraftMailboxId(draft.mailboxId);
				setLoadedDraftFrom(getEmailAddress(draft.fromAddr).toLowerCase());
			})
			.catch((err) => {
				if (cancelled) return;
				const message = err instanceof Error ? err.message : "Failed to load draft";
				setToast({ type: "error", message });
			})
			.finally(() => {
				if (!cancelled) setLoadingDraft(false);
			});

		return () => {
			cancelled = true;
		};
	}, [draftIdToLoad]);

	useEffect(() => {
		if (!loadedDraftMailboxId) return;
		if (selectedMailbox?.id === loadedDraftMailboxId) return;

		const draftMailbox = mailboxes.find((mailbox) => mailbox.id === loadedDraftMailboxId);
		if (draftMailbox) setSelectedMailbox(draftMailbox);
	}, [loadedDraftMailboxId, mailboxes, selectedMailbox?.id, setSelectedMailbox]);

	useEffect(() => {
		if (!loadedDraftFrom || !senderAddresses.includes(loadedDraftFrom)) return;
		setSelectedFrom(loadedDraftFrom);
	}, [loadedDraftFrom, senderAddresses]);

	useEffect(() => {
		if (loadingDraft) return;
		const nextSignature = selectedMailbox?.signature ?? "";
		setHtml((current) => applyMailboxSignatureHtml(current, previousSignature.current, nextSignature));
		previousSignature.current = nextSignature;
	}, [loadingDraft, selectedMailbox?.id, selectedMailbox?.signature]);

	useEffect(() => {
		const bodyContent = htmlToPlainText(html).trim();
		const signatureOnly = bodyContent === (selectedMailbox?.signature?.trim() ?? "");
		const hasContent =
			to.length > 0 || cc.length > 0 || bcc.length > 0 || subject.trim() || quotedHtml || (bodyContent && !signatureOnly);
		if (!fromAddr || !hasContent || loadingDraft) return;
		if (saveTimer.current) clearTimeout(saveTimer.current);

		const generation = draftGeneration.current;
		saveTimer.current = setTimeout(async () => {
			const payload = {
				mailboxId: selectedMailbox?.id,
				from: fromAddr,
				to: recipientsToHeader(to),
				cc: recipientsToHeader(cc),
				bcc: recipientsToHeader(bcc),
				subject,
				html: joinQuotedHtml(html, quotedHtml),
				text: htmlToPlainText(joinQuotedHtml(html, quotedHtml)),
				inReplyTo: threading?.inReplyTo ?? null,
				references: threading?.references ?? null,
				threadId: threading?.threadId ?? null,
			};
			const res = await authFetch(draftId ? `/api/drafts/${draftId}` : "/api/drafts", {
				method: draftId ? "PATCH" : "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			const data = (await res.json()) as { draft?: { id: string } };
			if (res.ok && data.draft?.id) {
				if (generation !== draftGeneration.current) {
					void authFetch(`/api/drafts/${data.draft.id}`, { method: "DELETE" });
					return;
				}
				setDraftId(data.draft.id);
			}
		}, 900);

		return () => {
			if (saveTimer.current) clearTimeout(saveTimer.current);
		};
	}, [bcc, cc, draftId, fromAddr, html, loadingDraft, quotedHtml, selectedMailbox?.id, selectedMailbox?.signature, subject, threading, to]);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (to.length === 0) {
			setToast({ type: "error", message: "Add at least one recipient" });
			return;
		}
		const invalid = [...to, ...cc, ...bcc].find((entry) => !isValidRecipient(entry));
		if (invalid) {
			setToast({ type: "error", message: `"${invalid}" is not a valid email address` });
			return;
		}
		if (!hasMeaningfulHtml(html) && !quotedHtml) {
			setToast({ type: "error", message: "Write a message before sending" });
			return;
		}
		setLoading(true);
		let fullHtml = joinQuotedHtml(html, quotedHtml);
		const unattachedInline: Array<{ file: File; contentId: string }> = [];
		if (draftId) {
			try {
				fullHtml = await flushInlineImages(draftId);
			} catch (cause) {
				setLoading(false);
				setToast({ type: "error", message: cause instanceof Error ? cause.message : "Could not embed image" });
				return;
			}
			await pruneInlineImages(fullHtml, draftId);
			// Point stored body images at their cid: references; the draft keeps its
			// fetchable URLs while the outgoing message needs cid parts. Sources that
			// were pruned are no longer in the HTML, so stale entries rewrite nothing.
			fullHtml = rewriteInlineImageSources(fullHtml, [
				...inlineImages.current
					.filter((image) => image.attachmentId && image.contentId)
					.map((image) => ({ src: image.src, contentId: image.contentId })),
				...inlineStoredAttachments.map((item) => ({
					src: draftAttachmentUrl(draftId, item.id),
					contentId: item.contentId,
				})),
			]);
		} else {
			// No draft landed yet (sent within the autosave window); send the
			// images along as inline attachments with client-assigned cids.
			for (const image of inlineImages.current.filter((item) => !item.attachmentId && fullHtml.includes(item.src))) {
				const contentId = crypto.randomUUID();
				fullHtml = fullHtml.replaceAll(`src="${image.src}"`, `src="cid:${contentId}"`);
				unattachedInline.push({ file: image.file, contentId });
			}
		}
		if (draftId && agentRevision !== null) {
			try {
				if (saveTimer.current) clearTimeout(saveTimer.current);
				if (attachments.length > 0) {
					const form = new FormData();
					for (const attachment of attachments) form.append("attachments", attachment.file);
					const uploaded = await authFetch(`/api/drafts/${draftId}/attachments`, { method: "POST", body: form });
					const result = await uploaded.json() as { attachments?: ComposeStoredAttachment[]; error?: string };
					if (!uploaded.ok) throw new Error(result.error || "Could not add attachments to the draft");
					setStoredAttachments((current) => [...current, ...(result.attachments ?? [])]);
					setAttachments([]);
				}
				const updated = await authFetch(`/api/drafts/${draftId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mailboxId: selectedMailbox?.id, from: fromAddr, to: recipientsToHeader(to), cc: recipientsToHeader(cc), bcc: recipientsToHeader(bcc), subject, html: fullHtml, text: htmlToPlainText(fullHtml), inReplyTo: threading?.inReplyTo ?? null, references: threading?.references ?? null, threadId: threading?.threadId ?? null, scheduledAt: scheduledAt?.toISOString() ?? null }) });
				if (!updated.ok) throw new Error("Could not save the draft for review");
				const current = await fetchDraft(draftId);
				if (!current.agent) throw new Error("AI draft metadata is missing");
				setAgentRevision(current.agent.revision);
				const response = await authFetch("/api/agent/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId, expectedRevision: current.agent.revision }) });
				const result = await response.json() as { approvalId?: string; snapshot?: ReviewSnapshot; error?: string };
				if (!response.ok || !result.approvalId || !result.snapshot) throw new Error(result.error || "Could not create review");
				setAgentReview({ approvalId: result.approvalId, snapshot: result.snapshot });
			} catch (cause) { setToast({ type: "error", message: cause instanceof Error ? cause.message : "Could not review draft" }); }
			finally { setLoading(false); }
			return;
		}
		const res = await authFetch("/api/send", {
			method: "POST",
			body: buildSendFormData({
				attachments,
				inlineImages: unattachedInline,
				from: fromAddr,
				to: recipientsToHeader(to),
				cc: recipientsToHeader(cc),
				bcc: recipientsToHeader(bcc),
				subject,
				text: htmlToPlainText(fullHtml),
				html: fullHtml,
				mailboxId: selectedMailbox?.id,
				threading: threading ?? undefined,
				draftId,
				scheduledAt,
			}),
		});
		const data = (await res.json()) as { messageId?: string; scheduled?: boolean; error?: string };
		setLoading(false);

		if (!res.ok) {
			setToast({ type: "error", message: data.error ?? "Send failed" });
			return;
		}

		if (draftId) {
			void authFetch(`/api/drafts/${draftId}`, { method: "DELETE" }).finally(() => {
				window.dispatchEvent(new Event("mailflare:messages-changed"));
			});
		}
		setDraftId(null);
		setTo([]);
		setCc([]);
		setBcc([]);
		setShowCc(false);
		setShowBcc(false);
		setThreading(null);
		setStoredAttachments([]);
		setInlineStoredAttachments([]);
		resetInlineImages();
		setSubject("");
		setHtml(applyMailboxSignatureHtml("", "", selectedMailbox?.signature));
		setQuotedHtml(null);
		setAttachments([]);
		setScheduledAt(null);
		setToast({ type: "success", message: data.scheduled ? "Message scheduled" : "Message sent" });
		window.dispatchEvent(new Event("mailflare:messages-changed"));
	}

	async function deleteDraftAndClose() {
		if (saveTimer.current) clearTimeout(saveTimer.current);
		draftGeneration.current += 1;
		setDeletingDraft(true);

		if (draftId) {
			const res = await authFetch(`/api/drafts/${draftId}`, { method: "DELETE" });
			if (!res.ok) {
				setDeletingDraft(false);
				setToast({ type: "error", message: "Could not delete draft" });
				return;
			}
		}

		setDraftId(null);
		setTo([]);
		setCc([]);
		setBcc([]);
		setShowCc(false);
		setShowBcc(false);
		setThreading(null);
		setStoredAttachments([]);
		setInlineStoredAttachments([]);
		resetInlineImages();
		setSubject("");
		setHtml(applyMailboxSignatureHtml("", "", selectedMailbox?.signature));
		setQuotedHtml(null);
		setAttachments([]);
		setScheduledAt(null);
		window.dispatchEvent(new Event("mailflare:messages-changed"));

		if (onClose) {
			onClose();
			return;
		}
		setDeletingDraft(false);
		router.push("/inbox");
	}

	async function removeStoredAttachment(attachmentId: string) {
		if (!draftId) return;
		const res = await authFetch(`/api/drafts/${draftId}/attachments/${attachmentId}`, { method: "DELETE" });
		if (!res.ok) {
			setToast({ type: "error", message: "Could not remove attachment" });
			return;
		}
		setStoredAttachments((current) => current.filter((item) => item.id !== attachmentId));
	}

	async function uploadInlineImages(id: string, files: File[]): Promise<Array<{ id: string; contentId: string | null }>> {
		const form = new FormData();
		for (const file of files) form.append("inlineAttachments", file);
		const res = await authFetch(`/api/drafts/${id}/attachments`, { method: "POST", body: form });
		const result = (await res.json()) as { attachments?: Array<{ id: string; contentId: string | null }>; error?: string };
		if (!res.ok || !result.attachments) throw new Error(result.error || "Could not embed image");
		return result.attachments;
	}

	function resetInlineImages() {
		for (const image of inlineImages.current) {
			if (image.src.startsWith("blob:")) URL.revokeObjectURL(image.src);
		}
		inlineImages.current = [];
	}

	/** Drop embedded images the user removed from the body so they are not sent along as orphans. */
	async function pruneInlineImages(currentHtml: string, id: string): Promise<void> {
		const kept: InlineImageState[] = [];
		for (const image of inlineImages.current) {
			if (currentHtml.includes(image.src)) {
				kept.push(image);
				continue;
			}
			if (image.attachmentId) {
				await authFetch(`/api/drafts/${id}/attachments/${image.attachmentId}`, { method: "DELETE" }).catch(() => {});
			} else {
				URL.revokeObjectURL(image.src);
			}
		}
		inlineImages.current = kept;
		const keptStored: Array<ComposeStoredAttachment & { contentId: string }> = [];
		for (const item of inlineStoredAttachments) {
			if (currentHtml.includes(draftAttachmentUrl(id, item.id))) {
				keptStored.push(item);
				continue;
			}
			await authFetch(`/api/drafts/${id}/attachments/${item.id}`, { method: "DELETE" }).catch(() => {});
		}
		setInlineStoredAttachments(keptStored);
	}

	/** Upload blob-backed images to the draft and point the body at their stored URLs. Returns the rewritten body HTML. */
	async function flushInlineImages(id: string): Promise<string> {
		const pending = inlineImages.current.filter((image) => !image.attachmentId);
		if (!pending.length) return html;
		const stored = await uploadInlineImages(id, pending.map((image) => image.file));
		inlineImages.current = inlineImages.current.map((image) => {
			const index = pending.findIndex((item) => item.src === image.src);
			const item = stored[index];
			return index >= 0 && item
				? { ...image, src: draftAttachmentUrl(id, item.id), attachmentId: item.id, contentId: item.contentId }
				: image;
		});
		const rewritten = pending.reduce(
			(current, image, index) => {
				const item = stored[index];
				return item ? current.replaceAll(`src="${image.src}"`, `src="${draftAttachmentUrl(id, item.id)}"`) : current;
			},
			html,
		);
		setHtml(rewritten);
		return rewritten;
	}

	async function embedImages(files: File[]): Promise<Array<{ src: string; alt?: string } | null>> {
		if (loading || loadingDraft) return files.map(() => null);
		const processed = await Promise.all(files.map(maybeDownscaleImage));
		const inline = inlineImages.current;
		const nextCount = storedAttachments.length + attachments.length + inline.length + processed.length;
		const totalSize =
			storedAttachments.reduce((total, item) => total + item.size, 0) +
			[...attachments.map((attachment) => attachment.file), ...inline.map((image) => image.file), ...processed].reduce(
				(total, file) => total + file.size,
				0,
			);
		const reject = (message: string) => {
			setToast({ type: "error", message });
			return processed.map(() => null);
		};
		if (nextCount > 10) return reject("A message can include at most 10 attachments");
		if (processed.some((file) => file.size > attachmentPolicy.maxMb * 1_000_000)) {
			return reject(`Each attachment must be ${attachmentPolicy.maxMb} MB or smaller`);
		}
		if (totalSize > attachmentPolicy.maxMb * 1_000_000) {
			return reject(`Attachments must total ${attachmentPolicy.maxMb} MB or less`);
		}
		if (draftId) {
			try {
				const stored = await uploadInlineImages(draftId, processed);
				return processed.map((file, index) => {
					const item = stored[index];
					if (!item) return null;
					const src = draftAttachmentUrl(draftId, item.id);
					inlineImages.current.push({ file, src, attachmentId: item.id, contentId: item.contentId });
					return { src, alt: file.name };
				});
			} catch (cause) {
				return reject(cause instanceof Error ? cause.message : "Could not embed image");
			}
		}
		return processed.map((file) => {
			const src = URL.createObjectURL(file);
			inlineImages.current.push({ file, src, attachmentId: null, contentId: null });
			return { src, alt: file.name };
		});
	}

	useEffect(() => {
		if (!draftId) return;
		void flushInlineImages(draftId).catch((cause) => {
			setToast({ type: "error", message: cause instanceof Error ? cause.message : "Could not embed image" });
		});
		// flushInlineImages reads the current body HTML from state; draftId is the trigger.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [draftId]);

	function addAttachments(files: FileList | null) {
		if (!files) return;
		const nextFiles = Array.from(files);
		const nextCount = storedAttachments.length + attachments.length + nextFiles.length;
		const totalSize =
			storedAttachments.reduce((total, item) => total + item.size, 0) +
			[...attachments.map((attachment) => attachment.file), ...nextFiles].reduce(
				(total, file) => total + file.size,
				0,
			);

		if (nextCount > 10) {
			setToast({ type: "error", message: "A message can include at most 10 attachments" });
			return;
		}
		if (nextFiles.some((file) => file.size > attachmentPolicy.maxMb * 1_000_000)) {
			setToast({ type: "error", message: `Each attachment must be ${attachmentPolicy.maxMb} MB or smaller` });
			return;
		}
		if (totalSize > attachmentPolicy.maxMb * 1_000_000) {
			setToast({ type: "error", message: `Attachments must total ${attachmentPolicy.maxMb} MB or less` });
			return;
		}

		setAttachments((current) => [
			...current,
			...nextFiles.map((file) => ({ id: crypto.randomUUID(), file })),
		]);
		if (attachmentInput.current) attachmentInput.current.value = "";
	}

	function onFileDragEnter(event: DragEvent<HTMLFormElement>) {
		if (!event.dataTransfer.types.includes("Files")) return;
		fileDragDepth.current += 1;
		if (!loading && !loadingDraft) setDraggingFiles(true);
	}

	function onFileDragOver(event: DragEvent<HTMLFormElement>) {
		if (!event.dataTransfer.types.includes("Files")) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = loading || loadingDraft ? "none" : "copy";
	}

	function onFileDragLeave(event: DragEvent<HTMLFormElement>) {
		if (!event.dataTransfer.types.includes("Files")) return;
		fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
		if (fileDragDepth.current === 0) setDraggingFiles(false);
	}

	function onFileDrop(event: DragEvent<HTMLFormElement>) {
		if (!event.dataTransfer.types.includes("Files")) return;
		event.preventDefault();
		fileDragDepth.current = 0;
		setDraggingFiles(false);
		if (loading || loadingDraft) return;
		const files = Array.from(event.dataTransfer.files);
		// A drop of only images inside the body embeds them; anywhere else attaches.
		const overEditor = event.target instanceof Element && event.target.closest("[data-compose-editor]");
		if (overEditor && files.length > 0 && files.every(isImageFile)) return;
		addAttachments(event.dataTransfer.files);
	}

	function selectSender(value: string) {
		const option = senderOptions.find((item) => `${item.mailbox.id}|${item.address}` === value);
		if (!option) return;
		setSelectedFrom(option.address);
		if (selectedMailbox?.id !== option.mailbox.id) setSelectedMailbox(option.mailbox);
	}

	const attachmentContent = (attachments.length > 0 || storedAttachments.length > 0) && (
		<div>
		<div className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto overflow-y-hidden px-3 py-2">
			{storedAttachments.map((attachment) => (
				<div
					key={attachment.id}
					className="flex max-w-full shrink-0 items-center gap-2 rounded-lg bg-neutral-100 px-2 py-1 text-xs"
					title="Carried over from the forwarded message"
				>
					<FileText className="h-4 w-4 shrink-0 text-neutral-500" />
					<span className="max-w-48 truncate">{attachment.filename}</span>
					<span className="text-xs text-neutral-400">{formatAttachmentSize(attachment.size)}</span>
					<button
						type="button"
						onClick={() => void removeStoredAttachment(attachment.id)}
						className="rounded-full p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
					>
						<X className="h-3.5 w-3.5" />
						<span className="sr-only">Remove attachment</span>
					</button>
				</div>
			))}
			{attachments.map((attachment) => (
				<div
					key={attachment.id}
					className="flex max-w-full shrink-0 items-center gap-2 rounded-lg bg-neutral-100 px-2 py-1 text-xs"
				>
					<FileText className="h-4 w-4 shrink-0 text-neutral-500" />
					<span className="max-w-48 truncate font-medium">{attachment.file.name}</span>
					<span className="text-xs text-neutral-400">
						{formatAttachmentSize(attachment.file.size)}
					</span>
					<button
						type="button"
						onClick={() =>
							setAttachments((current) =>
								current.filter((item) => item.id !== attachment.id),
							)
						}
						className="rounded-full p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
					>
						<X className="h-3.5 w-3.5" />
						<span className="sr-only">Remove attachment</span>
					</button>
				</div>
			))}
		</div>
		<p className="px-3 pb-2 text-xs text-amber-700">Cloudflare limits general email messages to 5 MiB including encoding. Files over 3 MB{([...attachments.map((item) => item.file.size), ...storedAttachments.map((item) => item.size)].some((size) => size > attachmentPolicy.cloudThresholdBytes)) ? " here will" : " or files that exceed the message budget may"} be sent as 30-day R2 download links.</p>
		</div>
	);

	const frameClass =
		mode === "popup"
			? minimized
				? "fixed bottom-0 right-8 z-40 flex h-9 w-[min(260px,calc(100vw-32px))] flex-col overflow-hidden rounded-t-lg border border-neutral-200 bg-white shadow-2xl"
				: modalMode
				? "fixed left-1/2 top-1/2 z-50 flex h-[86vh] w-[min(860px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
				: "fixed bottom-0 right-8 z-40 flex h-[min(520px,calc(100vh-88px))] w-[min(560px,calc(100vw-32px))] flex-col overflow-hidden rounded-t-lg border border-neutral-200 bg-white shadow-2xl"
			: "relative flex h-full min-h-[720px] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm";

	return (
		<>
			{agentReview && <SendReview approvalId={agentReview.approvalId} snapshot={agentReview.snapshot} onClose={() => setAgentReview(null)} onSent={() => { setAgentReview(null); if (onClose) onClose(); else router.push("/sent"); }} />}
			{mode === "popup" && modalMode && !minimized && <div className="fixed inset-0 z-40 bg-neutral-950/65" aria-hidden="true" />}
			{toast && (
				<div
					className={cn(
						"fixed right-6 top-6 z-[60] rounded-lg px-4 py-3 text-sm font-medium shadow-lg",
						toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white",
					)}
				>
					{toast.message}
				</div>
			)}
			<form onSubmit={onSubmit} className={frameClass} role={modalMode && !minimized ? "dialog" : undefined} aria-modal={modalMode && !minimized || undefined} aria-label={modalMode && !minimized ? "Compose message" : undefined} onKeyDown={(event) => { if (modalMode && !minimized && event.key === "Escape") { event.preventDefault(); setModalMode(false); } }} onDragEnterCapture={minimized ? undefined : onFileDragEnter} onDragOverCapture={minimized ? undefined : onFileDragOver} onDragLeaveCapture={minimized ? undefined : onFileDragLeave} onDropCapture={minimized ? undefined : onFileDrop}>
				{draggingFiles && !minimized && (
					<div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-blue-400 bg-blue-50/90 text-sm font-medium text-blue-700" aria-hidden="true">
						Drop files to attach
					</div>
				)}
				<div className="flex h-9 shrink-0 items-center justify-between bg-neutral-800 px-4 text-sm font-medium text-white">
					<span className="flex min-w-0 items-center gap-2 truncate">
						{threading?.inReplyTo && <Reply className="h-3.5 w-3.5 text-neutral-300" />}
						{!threading?.inReplyTo && /^fwd?:/i.test(subject) && <Forward className="h-3.5 w-3.5 text-neutral-300" />}
						{loadingDraft
							? "Loading draft"
							: threading?.inReplyTo
								? "Reply"
								: /^fwd?:/i.test(subject)
									? "Forward"
									: draftId
										? "Draft saved"
										: "New Message"}
					</span>
					{mode === "popup" && (
						<div className="flex shrink-0 items-center gap-3 text-neutral-300">
							<button type="button" onClick={() => { setMinimized((current) => !current); setDraggingFiles(false); }} aria-label={minimized ? "Restore composer" : "Minimize composer"} title={minimized ? "Restore composer" : "Minimize composer"} className="rounded p-1 hover:bg-neutral-700 hover:text-white">
								{minimized ? <ChevronUp className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
							</button>
							<button type="button" onClick={() => { if (minimized) setMinimized(false); setModalMode((current) => !current); }} aria-label={modalMode ? "Restore floating composer" : "Open composer as modal"} title={modalMode ? "Restore floating composer" : "Open composer as modal"} className="rounded p-1 hover:bg-neutral-700 hover:text-white">
								{modalMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
							</button>
							<button type="button" onClick={onClose} aria-label="Close composer" className="rounded p-1 hover:bg-neutral-700 hover:text-white">
								<X className="h-4 w-4" />
							</button>
						</div>
					)}
				</div>
				<div className={cn("flex min-h-0 flex-1 flex-col", minimized && "hidden")}>
				<div className="border-b border-neutral-100 px-4 py-1 flex flex-row items-center">
					<Label htmlFor={`${mode}-from`} className="text-sm text-neutral-500">From</Label>
					<Select
						id={`${mode}-from`}
						value={selectedMailbox && selectedFrom ? `${selectedMailbox.id}|${selectedFrom}` : ""}
						onChange={(event) => selectSender(event.target.value)}
						// placeholder="Select a mailbox first"
						required
						disabled={loadingDraft || senderOptions.length === 0}
						className="h-8 px-0 py-1 text-sm shadow-none focus-visible:ring-0"
						containerClassName="border-0 flex-1"
					>
						{senderOptions.length === 0 && <option value="">Select a mailbox first</option>}
						{senderOptions.map(({ mailbox, address }) => (
							<option key={`${mailbox.id}|${address}`} value={`${mailbox.id}|${address}`}>{address}</option>
						))}
					</Select>
				</div>
				<RecipientInput
					id={`${mode}-to`}
					label="To"
					value={to}
					onChange={setTo}
					placeholder='Recipients, or "Maya Chen" <maya@example.com>'
					required
					disabled={loadingDraft}
					trailing={
						<>
							{!showCc && (
								<button type="button" className="rounded px-1 hover:text-neutral-800" onClick={() => setShowCc(true)}>
									Cc
								</button>
							)}
							{!showBcc && (
								<button type="button" className="rounded px-1 hover:text-neutral-800" onClick={() => setShowBcc(true)}>
									Bcc
								</button>
							)}
						</>
					}
				/>
				{showCc && (
					<RecipientInput
						id={`${mode}-cc`}
						label="Cc"
						value={cc}
						onChange={setCc}
						placeholder="Carbon copy"
						disabled={loadingDraft}
						autoFocus={!loadingDraft && cc.length === 0}
					/>
				)}
				{showBcc && (
					<RecipientInput
						id={`${mode}-bcc`}
						label="Bcc"
						value={bcc}
						onChange={setBcc}
						placeholder="Blind carbon copy, hidden from other recipients"
						disabled={loadingDraft}
						autoFocus={!loadingDraft && bcc.length === 0}
					/>
				)}
				<div className="border-b border-neutral-100 px-4 py-1">
					<Label htmlFor={`${mode}-subject`} className="sr-only">Subject</Label>
					<Input
						id={`${mode}-subject`}
						value={subject}
						onChange={(event) => setSubject(event.target.value)}
						placeholder="Subject"
						required
						disabled={loadingDraft}
						className="h-8 border-0 px-0 py-1 shadow-none focus-visible:ring-0"
					/>
				</div>
				<Label htmlFor={`${mode}-text`} className="sr-only">Body</Label>
				<RichTextEditor
					id={`${mode}-text`}
					value={html}
					onChange={setHtml}
					quotedHtml={quotedHtml}
					disabled={loadingDraft}
					placeholder="Write your message"
					footerContent={attachmentContent}
					onEmbedImages={embedImages}
					toolbarStart={
						<>
							<div className="flex items-center">
								<Button
									type="submit"
									size="sm"
									disabled={loading || loadingDraft || !fromAddr}
									className="rounded-r-none px-4"
								>
									{loading ? "Preparing…" : scheduledAt ? "Schedule" : agentRevision !== null ? "Review send" : "Send"}
								</Button>
								<ScheduleSendMenu
									disabled={loading || loadingDraft || !fromAddr}
									value={scheduledAt}
									onChange={setScheduledAt}
								/>
							</div>
						</>
					}
					toolbarEnd={
						<>
							{/* <span className="mx-1 h-5 w-px bg-neutral-200" /> */}
							<Input
								ref={attachmentInput}
								type="file"
								multiple
								className="hidden"
								onChange={(event) => addAttachments(event.target.files)}
							/>
							<Tooltip label={`Attach files (up to ${attachmentPolicy.maxMb} MB total). Files over 3 MB are sent as 30-day R2 download links.`}>
								<button
									type="button"
									aria-label="Attach files"
									onClick={() => attachmentInput.current?.click()}
									disabled={loading || loadingDraft}
									className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:pointer-events-none disabled:opacity-50"
								>
									<Paperclip className="h-4 w-4" />
								</button>
							</Tooltip>
							<span className="flex-1" />
							<Tooltip label="Delete draft">
								<button
									type="button"
									aria-label="Delete draft"
									onClick={() => void deleteDraftAndClose()}
									disabled={loading || loadingDraft || deletingDraft}
									className="rounded-md p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-50"
								>
									<Trash2 className="h-4 w-4" />
								</button>
							</Tooltip>
						</>
					}
				/>
				</div>
			</form>
		</>
	);
}
