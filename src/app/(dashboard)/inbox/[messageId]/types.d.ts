import type { Message } from "@/hooks/types";
import type { ReplyContentParts } from "@/lib/email/reply-content-types";

export type MessageDetailResponse = {
	message?: Message;
	body?: {
		htmlBody: string | null;
		textBody: string | null;
	} | null;
	attachments?: MessageAttachment[];
	unsubscribeUrl?: string | null;
	invite?: MessageInvite | null;
	error?: string;
};

export type MessageInvite = {
	uid: string;
	summary: string;
	description: string;
	location: string;
	startsAt: string;
	endsAt: string | null;
	allDay: boolean;
	organizerEmail: string | null;
	responded: boolean;
};

export type MessageAttachment = {
	contentId: string | null;
	disposition: "attachment" | "inline";
	filename: string;
	id: string;
	messageId: string;
	size: number;
	type: string;
};

export type MessageBodyDisplay = ReplyContentParts & {
	htmlBody: string | null;
	/** Quoted/forwarded HTML a Mailflare composer folded under the message, shown collapsed. */
	quotedHtml: string | null;
	hasQuotedContent: boolean;
};
