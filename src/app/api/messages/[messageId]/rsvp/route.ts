import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { calendarEvents, domains, mailboxes, messages } from "@/db/schema";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { readJsonBody } from "@/lib/http/request";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import { newId } from "@/lib/ids";
import { normalizeCalendarColor } from "@/lib/calendar/colors";
import { buildIcsReply, type IcsReplyStatus } from "@/lib/calendar/ics";
import { inviteEventRef, loadMessageInvite } from "@/lib/calendar/invites";
import { pushInviteAcceptanceToGoogle } from "@/lib/calendar/google-push";
import { sendEmail } from "@/lib/email/send";
import type { RsvpRequest } from "./types";
import { parseRsvpRequest } from "./utils";

type MessageRouteParams = {
	params: Promise<{ messageId: string }>;
};

const REPLY_SUBJECTS: Record<string, string> = {
	accepted: "Accepted",
	declined: "Declined",
	tentative: "Tentative",
};

export async function POST(request: Request, { params }: MessageRouteParams) {
	const env = getEnv();
	const user = await requireUser(env, request);
	let status;
	try {
		const body = await readJsonBody<RsvpRequest>(request, 4 * 1024);
		status = parseRsvpRequest(body);
	} catch (error) {
		const httpStatus = error instanceof RequestBodyTooLargeError ? 413 : 400;
		return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid RSVP request" }, { status: httpStatus });
	}

	const { messageId } = await params;
	const db = getDb(env);
	const [message] = await db.select({ mailboxId: messages.mailboxId, userId: messages.userId }).from(messages).where(eq(messages.id, messageId)).limit(1);
	if (!message?.mailboxId) {
		return NextResponse.json({ error: "Message not found" }, { status: 404 });
	}
	const access = await getMailboxAccessLevel(db, user, message.mailboxId);
	if (!access?.canRead) {
		return NextResponse.json({ error: "Message not found" }, { status: 404 });
	}
	if (!access.canSendAs && !access.canManage) {
		return NextResponse.json({ error: "Responding to invites requires send permission for this mailbox" }, { status: 403 });
	}

	const invite = await loadMessageInvite(env, messageId);
	if (!invite) {
		return NextResponse.json({ error: "This message has no meeting invite" }, { status: 404 });
	}

	const ref = inviteEventRef(invite.uid);
	if (status === "declined") {
		await db.delete(calendarEvents).where(eq(calendarEvents.externalRef, ref));
	} else {
		const endsAt = invite.end ?? new Date(invite.start.getTime() + 30 * 60_000);
		const values = {
			id: newId("evt"),
			userId: message.userId,
			mailboxId: message.mailboxId,
			title: invite.summary,
			description: invite.description,
			location: invite.location,
			attendees: JSON.stringify(invite.organizerEmail ? [invite.organizerEmail] : invite.attendees.slice(0, 5)),
			color: normalizeCalendarColor("blue"),
			repeat: "none" as const,
			repeatDays: "[]",
			repeatAnchorDay: null,
			repeatUntil: null,
			excludedOccurrences: "[]",
			timeZone: invite.timeZone,
			startsAt: invite.start,
			endsAt,
			source: "invite" as const,
			sourceLabel: "Email invite",
			externalRef: ref,
			icalUid: invite.uid,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		const [existing] = await db.select({ id: calendarEvents.id }).from(calendarEvents).where(eq(calendarEvents.externalRef, ref)).limit(1);
		if (existing) {
			const { id: _replaceId, ...updateFields } = values;
			await db.update(calendarEvents).set(updateFields).where(eq(calendarEvents.id, existing.id));
		} else {
			await db.insert(calendarEvents).values(values);
		}
		if (access.canSendAs || access.canManage) {
			// Best-effort: put the accepted meeting on the linked Google calendar too.
			const googleRef = await pushInviteAcceptanceToGoogle(env, message.userId, {
				uid: invite.uid,
				summary: invite.summary,
				description: invite.description,
				location: invite.location,
				startsAt: invite.start,
				endsAt,
				timeZone: invite.timeZone,
				allDay: invite.allDay,
				attendees: invite.organizerEmail ? [invite.organizerEmail] : [],
			});
			if (googleRef) {
				await db.update(calendarEvents).set({ externalRef: googleRef, source: "google", updatedAt: new Date() }).where(eq(calendarEvents.id, values.id));
			}
		}
	}

	// iMIP reply so the organizer sees the response (best-effort).
	const organizerEmail = invite.organizerEmail;
	const mailboxAddress = await getMailboxAddress(db, message.mailboxId);
	let replySent = false;
	if (organizerEmail && mailboxAddress && organizerEmail.toLowerCase() !== mailboxAddress.toLowerCase()) {
		try {
			const replyIcs = buildIcsReply({
				uid: invite.uid,
				summary: invite.summary,
				start: invite.start,
				end: invite.end,
				organizerEmail,
				attendeeEmail: mailboxAddress,
				attendeeName: null,
				status: status.toUpperCase() as IcsReplyStatus,
			});
			const encoded = new TextEncoder().encode(replyIcs);
			const content = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
			await sendEmail(env, {
				userId: user.id,
				mailboxId: message.mailboxId,
				from: mailboxAddress,
				to: organizerEmail,
				subject: `${REPLY_SUBJECTS[status]}: ${invite.summary}`,
				text: `${mailboxAddress} has marked "${invite.summary}" as ${REPLY_SUBJECTS[status].toLowerCase()}.`,
				attachments: [{
					filename: "reply.ics",
					type: "text/calendar; charset=utf-8; method=REPLY",
					content,
				}],
			});
			replySent = true;
		} catch (error) {
			console.error("Invite reply failed", error);
		}
	}

	return NextResponse.json({ ok: true, status, replySent });
}

async function getMailboxAddress(db: ReturnType<typeof getDb>, mailboxId: string): Promise<string | null> {
	const [mailbox] = await db
		.select({ localPart: mailboxes.localPart, hostname: domains.hostname })
		.from(mailboxes)
		.innerJoin(domains, eq(mailboxes.domainId, domains.id))
		.where(and(eq(mailboxes.id, mailboxId), eq(domains.status, "active")))
		.limit(1);
	return mailbox ? `${mailbox.localPart}@${mailbox.hostname}` : null;
}
