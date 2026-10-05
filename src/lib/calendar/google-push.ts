import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { linkedCalendars } from "@/db/schema";
import { normalizeCalendarRepeatDays } from "@/lib/calendar/recurrence";
import { composioProxy } from "@/lib/composio/client";
import { buildGoogleRecurrence } from "./google-sync";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export type PushableGoogleEvent = {
	externalRef: string | null;
	title: string;
	description: string;
	location: string;
	startsAt: Date;
	endsAt: Date;
	repeat: "none" | "daily" | "weekly" | "monthly" | "weekdays";
	repeatDays: string;
	repeatUntil: Date | null;
	timeZone: string | null;
};

/**
 * Pushes a Mailflare-side edit of a Google-synced event back to Google Calendar.
 * Best-effort: failures are recorded on the linked calendar row and never block
 * the local edit; Google's copy converges on the next pull.
 */
export async function pushEventUpdateToGoogle(
	env: CloudflareEnv,
	userId: string,
	event: PushableGoogleEvent,
): Promise<void> {
	const parsed = parseExternalRef(event.externalRef);
	if (!parsed) return;
	const link = await findGoogleLinkByConnectedAccount(env, userId, parsed.connectedAccountId);
	if (!link) return;
	const eventId = parsed.eventId;
	const recurrence = buildGoogleRecurrence(event.repeat, normalizeCalendarRepeatDays(JSON.parse(event.repeatDays ?? "[]")), event.repeatUntil);
	const timeZone = event.timeZone ?? "UTC";
	try {
		await composioProxy(env, {
			connectedAccountId: link.connectedAccountId,
			method: "PATCH",
			endpoint: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(link.calendarId)}/events/${encodeURIComponent(eventId)}`,
			body: {
				summary: event.title,
				description: event.description,
				location: event.location,
				start: { dateTime: event.startsAt.toISOString(), timeZone },
				end: { dateTime: event.endsAt.toISOString(), timeZone },
				...(recurrence ? { recurrence } : {}),
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Google push failed";
		await getDb(env).update(linkedCalendars).set({ lastError: message }).where(eq(linkedCalendars.id, link.id));
	}
}

export async function pushEventDeleteToGoogle(
	env: CloudflareEnv,
	userId: string,
	eventRef: string | null,
): Promise<void> {
	const parsed = parseExternalRef(eventRef);
	if (!parsed) return;
	const link = await findGoogleLinkByConnectedAccount(env, userId, parsed.connectedAccountId);
	if (!link) return;
	const eventId = parsed.eventId;
	try {
		await composioProxy(env, {
			connectedAccountId: link.connectedAccountId,
			method: "DELETE",
			endpoint: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(link.calendarId)}/events/${encodeURIComponent(eventId)}`,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Google push failed";
		await getDb(env).update(linkedCalendars).set({ lastError: message }).where(eq(linkedCalendars.id, link.id));
	}
}

export async function findGoogleLink(
	env: CloudflareEnv,
	userId: string,
): Promise<typeof linkedCalendars.$inferSelect | null> {
	const [link] = await getDb(env)
		.select()
		.from(linkedCalendars)
		.where(and(eq(linkedCalendars.userId, userId), eq(linkedCalendars.calendarId, "primary")))
		.limit(1);
	return link ?? null;
}

/** External refs carry the owning connected account: google:{connectedAccountId}:{eventId}. */
function parseExternalRef(ref: string | null): { connectedAccountId: string; eventId: string } | null {
	if (!ref?.startsWith("google:")) return null;
	const rest = ref.slice("google:".length);
	const separator = rest.indexOf(":");
	if (separator < 1) return null;
	const connectedAccountId = rest.slice(0, separator);
	const eventId = rest.slice(separator + 1);
	return connectedAccountId && eventId ? { connectedAccountId, eventId } : null;
}

async function findGoogleLinkByConnectedAccount(
	env: CloudflareEnv,
	userId: string,
	connectedAccountId: string,
): Promise<typeof linkedCalendars.$inferSelect | null> {
	const [link] = await getDb(env)
		.select()
		.from(linkedCalendars)
		.where(and(eq(linkedCalendars.userId, userId), eq(linkedCalendars.connectedAccountId, connectedAccountId)))
		.limit(1);
	return link ?? null;
}

/** Finds or creates the Google copy of an accepted invite and returns its external ref. */
export async function pushInviteAcceptanceToGoogle(
	env: CloudflareEnv,
	userId: string,
	invite: {
		uid: string;
		summary: string;
		description: string;
		location: string;
		startsAt: Date;
		endsAt: Date;
		timeZone: string | null;
		allDay: boolean;
		attendees: string[];
	},
): Promise<string | null> {
	const link = await findGoogleLink(env, userId);
	if (!link) return null;
	const timeZone = invite.timeZone ?? "UTC";
	try {
		// Google may already hold this meeting (same invite accepted there); adopt it instead of duplicating.
		const existing = await composioProxy<{ items?: { id?: string }[] }>(env, {
			connectedAccountId: link.connectedAccountId,
			method: "GET",
			endpoint: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(link.calendarId)}/events`,
			query: { iCalUID: invite.uid, maxResults: 1, showDeleted: "false" },
		});
		const found = existing.items?.[0]?.id;
		if (found) return `google:${link.calendarId}:${found}`;

		const start = invite.allDay
			? { date: invite.startsAt.toISOString().slice(0, 10) }
			: { dateTime: invite.startsAt.toISOString(), timeZone };
		const end = invite.allDay
			? { date: invite.endsAt.toISOString().slice(0, 10) }
			: { dateTime: invite.endsAt.toISOString(), timeZone };
		const created = await composioProxy<{ id?: string }>(env, {
			connectedAccountId: link.connectedAccountId,
			method: "POST",
			endpoint: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(link.calendarId)}/events`,
			body: {
				summary: invite.summary,
				description: invite.description,
				location: invite.location,
				iCalUID: invite.uid,
				start,
				end,
				attendees: invite.attendees.filter(Boolean).slice(0, 20).map((email) => ({ email })),
			},
		});
		if (created.id) return `google:${link.calendarId}:${created.id}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : "Google push failed";
		await getDb(env).update(linkedCalendars).set({ lastError: message }).where(eq(linkedCalendars.id, link.id));
	}
	return null;
}

/** Creates a brand-new event on the chosen linked Google calendar; returns its external ref. */
export async function pushEventCreateToGoogle(
	env: CloudflareEnv,
	userId: string,
	connectedAccountId: string,
	event: PushableGoogleEvent,
): Promise<string | null> {
	const link = await findGoogleLinkByConnectedAccount(env, userId, connectedAccountId);
	if (!link) return null;
	const timeZone = event.timeZone ?? "UTC";
	try {
		const created = await composioProxy<{ id?: string }>(env, {
			connectedAccountId: link.connectedAccountId,
			method: "POST",
			endpoint: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(link.calendarId)}/events`,
			body: {
				summary: event.title,
				description: event.description,
				location: event.location,
				start: { dateTime: event.startsAt.toISOString(), timeZone },
				end: { dateTime: event.endsAt.toISOString(), timeZone },
				...(buildGoogleRecurrence(event.repeat, normalizeCalendarRepeatDays(JSON.parse(event.repeatDays ?? "[]")), event.repeatUntil)
					? { recurrence: buildGoogleRecurrence(event.repeat, normalizeCalendarRepeatDays(JSON.parse(event.repeatDays ?? "[]")), event.repeatUntil) }
					: {}),
			},
		});
		if (created.id) return `google:${link.connectedAccountId}:${created.id}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : "Google push failed";
		await getDb(env).update(linkedCalendars).set({ lastError: message }).where(eq(linkedCalendars.id, link.id));
	}
	return null;
}
