import type { AttachmentContent } from "@/lib/email/attachment-types";

export interface SendRequestPayload {
	attachments?: AttachmentContent[];
	from: string;
	html?: string;
	mailboxId?: string;
	subject: string;
	text?: string;
	to: string;
	cc?: string;
	bcc?: string;
	inReplyTo?: string;
	references?: string;
	threadId?: string;
	/** Draft whose stored attachments (e.g. forwarded files) should be sent along. */
	draftId?: string;
	scheduledAt?: string;
	/** When set, remind the sender if no reply lands in the thread by this time. */
	followUpAt?: string;
}
