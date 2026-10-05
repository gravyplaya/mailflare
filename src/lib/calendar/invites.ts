import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarEvents, messageAttachments } from "@/db/schema";
import { parseIcsInvite, type IcsInvite } from "./ics";

/**
 * Loads the meeting invite carried by a message, if any.
 * A METHOD:CANCEL invite removes the previously accepted event and returns
 * null, since there is nothing left to respond to.
 */
export async function loadMessageInvite(env: CloudflareEnv, messageId: string): Promise<IcsInvite | null> {
	const db = getDb(env);
	const rows = await db
		.select({ r2Key: messageAttachments.r2Key, filename: messageAttachments.filename, contentType: messageAttachments.contentType })
		.from(messageAttachments)
		.where(eq(messageAttachments.messageId, messageId));
	const ics = rows.find((row) => row.contentType.startsWith("text/calendar") || /\.ics$/i.test(row.filename));
	if (!ics) return null;
	const object = await env.BUCKET.get(ics.r2Key);
	if (!object) return null;
	const invite = parseIcsInvite(await object.text());
	if (!invite) return null;
	if (invite.method === "CANCEL") {
		await deleteInviteEvent(db, invite.uid);
		return null;
	}
	return invite;
}

export function inviteEventRef(uid: string): string {
	return `invite:${uid}`;
}

async function deleteInviteEvent(db: ReturnType<typeof getDb>, uid: string): Promise<void> {
	await db.delete(calendarEvents).where(eq(calendarEvents.externalRef, inviteEventRef(uid)));
}

/** Returns the local RSVP state for an invite, if it was already answered. */
export async function getInviteStatus(env: CloudflareEnv, uid: string): Promise<"accepted" | "tentative" | null> {
	const [row] = await getDb(env)
		.select({ id: calendarEvents.id })
		.from(calendarEvents)
		.where(eq(calendarEvents.externalRef, inviteEventRef(uid)))
		.limit(1);
	return row ? "accepted" : null;
}
