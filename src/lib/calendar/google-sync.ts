import { and, eq, gte, isNull, like, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarEvents, linkedCalendars } from "@/db/schema";
import { normalizeCalendarRepeatDays, parseExcludedOccurrences } from "@/lib/calendar/recurrence";
import { normalizeCalendarColor } from "@/lib/calendar/colors";
import { ComposioError, composioProxy } from "@/lib/composio/client";
import { newId } from "@/lib/ids";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
/** Import window: 30 days back, 180 days forward. */
const SYNC_WINDOW_PAST_MS = 30 * 24 * 60 * 60_000;
const SYNC_WINDOW_FUTURE_MS = 180 * 24 * 60 * 60_000;
const SYNC_MAX_PAGES = 5;

type GoogleEvent = {
	id: string;
	status?: string;
	summary?: string;
	description?: string;
	location?: string;
	iCalUID?: string;
	recurrence?: string[];
	start?: { date?: string; dateTime?: string; timeZone?: string };
	end?: { date?: string; dateTime?: string; timeZone?: string };
	attendees?: { email?: string }[];
	recurringEventId?: string;
};

export type GoogleCalendarSyncResult = {
	calendarId: string;
	imported: number;
	updated: number;
	removed: number;
	error?: string;
};

/**
 * Pulls events from the linked Google calendars into calendar_events.
 *
 * Full sync (no cursor): lists the window 30 days back / 180 days forward.
 * Incremental: events.list with the stored syncToken; when Google expires it
 * (HTTP 410) the sync falls back to a fresh full listing of the window.
 *
 * Recurrence: simple RRULEs map onto Mailflare's repeat model; anything else
 * is imported as the first occurrence only (Mailflare edits push back to
 * Google at edit time; Google is the source of truth for pulled content).
 */
export async function runGoogleCalendarSync(
	env: CloudflareEnv,
	only?: { connectedAccountId?: string },
): Promise<GoogleCalendarSyncResult[]> {
	if (!env.COMPOSIO_API_KEY) return [];
	const db = getDb(env);
	const links = await db.select().from(linkedCalendars);
	const results: GoogleCalendarSyncResult[] = [];
	for (const link of links) {
		if (only?.connectedAccountId && link.connectedAccountId !== only.connectedAccountId) continue;
		try {
			results.push({ calendarId: link.calendarId, ...(await syncLinkedCalendar(env, db, link)) });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Calendar sync failed";
			await db.update(linkedCalendars).set({ lastError: message }).where(eq(linkedCalendars.id, link.id));
			results.push({ calendarId: link.calendarId, imported: 0, updated: 0, removed: 0, error: message });
		}
	}
	return results;
}

type CalendarLink = typeof linkedCalendars.$inferSelect;
type SyncOutcome = Omit<GoogleCalendarSyncResult, "calendarId" | "error">;

async function syncLinkedCalendar(env: CloudflareEnv, db: ReturnType<typeof getDb>, link: CalendarLink): Promise<SyncOutcome> {
	const now = Date.now();
	const window = {
		timeMin: new Date(now - SYNC_WINDOW_PAST_MS).toISOString(),
		timeMax: new Date(now + SYNC_WINDOW_FUTURE_MS).toISOString(),
	};
	if (link.syncToken) {
		const incremental = await listEvents(env, link, { syncToken: link.syncToken });
		if (incremental.expired) return fullSync(env, db, link);
		const outcome = await applyEventChanges(env, db, link, incremental.items, undefined, window);
		if (incremental.nextSyncToken) {
			await saveLink(db, link, incremental.nextSyncToken);
		}
		return outcome;
	}
	return fullSync(env, db, link);
}

async function fullSync(env: CloudflareEnv, db: ReturnType<typeof getDb>, link: CalendarLink): Promise<SyncOutcome> {
	const now = Date.now();
	const window = {
		timeMin: new Date(now - SYNC_WINDOW_PAST_MS).toISOString(),
		timeMax: new Date(now + SYNC_WINDOW_FUTURE_MS).toISOString(),
	};
	const listing = await listAllEvents(env, link, window);
	const keptRefs = new Set<string>();
	const outcome = await applyEventChanges(env, db, link, listing.items, keptRefs, window);
	// Flattened instances are not part of the master listing; keep their refs too.
	const removed = await deleteMissingGoogleEvents(db, link, keptRefs);
	if (listing.nextSyncToken) {
		await saveLink(db, link, listing.nextSyncToken);
	}
	return { ...outcome, removed };
}

async function saveLink(db: ReturnType<typeof getDb>, link: CalendarLink, syncToken: string): Promise<void> {
	await db.update(linkedCalendars).set({ syncToken, lastSyncedAt: new Date(), lastError: null }).where(eq(linkedCalendars.id, link.id));
}

async function listEvents(
	env: CloudflareEnv,
	link: CalendarLink,
	query: { syncToken?: string; timeMin?: string; timeMax?: string; pageToken?: string },
): Promise<{ items: GoogleEvent[]; nextSyncToken?: string; nextPageToken?: string; expired?: boolean }> {
	let data: { items?: GoogleEvent[]; nextSyncToken?: string; nextPageToken?: string };
	try {
		data = await composioProxy<{ items?: GoogleEvent[]; nextSyncToken?: string; nextPageToken?: string }>(env, {
			connectedAccountId: link.connectedAccountId,
			method: "GET",
			endpoint: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(link.calendarId)}/events`,
			query: {
				syncToken: query.syncToken,
				timeMin: query.timeMin,
				timeMax: query.timeMax,
				maxResults: 250,
				pageToken: query.pageToken,
			},
		});
	} catch (error) {
		if (error instanceof ComposioError && error.status === 410) return { items: [], expired: true };
		throw error;
	}
	return { items: data.items ?? [], nextSyncToken: data.nextSyncToken, nextPageToken: data.nextPageToken };
}

async function listAllEvents(
	env: CloudflareEnv,
	link: CalendarLink,
	query: { timeMin: string; timeMax: string },
): Promise<{ items: GoogleEvent[]; nextSyncToken?: string }> {
	const items: GoogleEvent[] = [];
	let pageToken: string | undefined;
	let nextSyncToken: string | undefined;
	for (let page = 0; page < SYNC_MAX_PAGES; page += 1) {
		const outcome = await listEvents(env, link, { ...query, pageToken });
		items.push(...outcome.items);
		nextSyncToken = outcome.nextSyncToken ?? nextSyncToken;
		pageToken = outcome.nextPageToken;
		if (!pageToken) break;
	}
	return { items, nextSyncToken };
}

function externalRef(link: CalendarLink, eventId: string): string {
	return `google:${link.connectedAccountId}:${eventId}`;
}

async function applyEventChanges(
	env: CloudflareEnv,
	db: ReturnType<typeof getDb>,
	link: CalendarLink,
	events: GoogleEvent[],
	keptRefs?: Set<string>,
	window?: { timeMin: string; timeMax: string },
): Promise<SyncOutcome> {
	let imported = 0;
	let updated = 0;
	let removed = 0;
	for (const event of events) {
		const ref = externalRef(link, event.id);
		if (event.status === "cancelled") {
			removed += await applyCancellation(db, link, event, ref);
			continue;
		}
		if (keptRefs) keptRefs.add(ref);
		if (event.recurrence?.length && !parseRecurrence(event.recurrence, parseGoogleTime(event.start) ?? new Date())) {
			// Exotic rule Mailflare cannot represent: flatten into individual occurrences.
			const instances = await listEventInstances(env, link, event.id, window);
			for (const instance of instances) {
				const instanceRef = externalRef(link, instance.id);
				if (instance.status === "cancelled") {
					removed += await deleteByRef(db, instanceRef);
					continue;
				}
				if (keptRefs) keptRefs.add(instanceRef);
				const instanceOutcome = await upsertGoogleEvent(db, link, instance, instanceRef);
				if (instanceOutcome === "inserted") imported += 1;
				if (instanceOutcome === "updated") updated += 1;
			}
			continue;
		}
		const outcome = await upsertGoogleEvent(db, link, event, ref);
		if (outcome === "inserted") imported += 1;
		if (outcome === "updated") updated += 1;
	}
	return { imported, updated, removed };
}

async function listEventInstances(
	env: CloudflareEnv,
	link: CalendarLink,
	eventId: string,
	window?: { timeMin: string; timeMax: string },
): Promise<GoogleEvent[]> {
	const instances: GoogleEvent[] = [];
	let pageToken: string | undefined;
	for (let page = 0; page < SYNC_MAX_PAGES; page += 1) {
		const data = await composioProxy<{ items?: GoogleEvent[]; nextPageToken?: string }>(env, {
			connectedAccountId: link.connectedAccountId,
			method: "GET",
			endpoint: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(link.calendarId)}/events/${encodeURIComponent(eventId)}/instances`,
			query: { timeMin: window?.timeMin, timeMax: window?.timeMax, maxResults: 250, pageToken },
		});
		instances.push(...(data.items ?? []));
		pageToken = data.nextPageToken;
		if (!pageToken) break;
	}
	return instances;
}

async function deleteByRef(db: ReturnType<typeof getDb>, ref: string): Promise<number> {
	const deleted = await db.delete(calendarEvents).where(eq(calendarEvents.externalRef, ref)).returning({ id: calendarEvents.id });
	return deleted.length;
}

/**
 * A cancelled Google event either vanishes entirely (plain event) or is one
 * occurrence of a mapped recurring series; the latter becomes an excluded
 * occurrence on the master row instead of deleting the whole series.
 */
async function applyCancellation(
	db: ReturnType<typeof getDb>,
	link: CalendarLink,
	event: GoogleEvent,
	ref: string,
): Promise<number> {
	const occurrenceStart = event.recurringEventId ? parseInstanceStartTime(event.id) : null;
	if (!occurrenceStart) return deleteByRef(db, ref);
	const [master] = await db.select({ id: calendarEvents.id, excludedOccurrences: calendarEvents.excludedOccurrences }).from(calendarEvents)
		.where(and(eq(calendarEvents.externalRef, externalRef(link, event.recurringEventId ?? event.id)), eq(calendarEvents.source, "google")))
		.limit(1);
	if (!master) return 0;
	const excluded = parseExcludedOccurrences(master.excludedOccurrences);
	if (excluded.includes(occurrenceStart.getTime())) return 0;
	await db.update(calendarEvents).set({
		excludedOccurrences: JSON.stringify([...excluded, occurrenceStart.getTime()]),
		updatedAt: new Date(),
	}).where(eq(calendarEvents.id, master.id));
	return 0;
}

/** Instance ids look like {masterId}_{yyyymmddThhmmssZ}; returns the occurrence start. */
function parseInstanceStartTime(instanceId: string): Date | null {
	const separator = instanceId.lastIndexOf("_");
	if (separator < 1) return null;
	const stamp = instanceId.slice(separator + 1).replace(/Z$/, "");
	const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(stamp);
	if (!match) return null;
	const [, year, month, day, hour, minute, second] = match;
	const wall = new Date(0);
	wall.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
	wall.setUTCHours(Number(hour), Number(minute), Number(second), 0);
	return wall;
}

async function upsertGoogleEvent(
	db: ReturnType<typeof getDb>,
	link: CalendarLink,
	event: GoogleEvent,
	ref: string,
): Promise<"inserted" | "updated" | "skipped"> {
	const values = mapGoogleEvent(link, event);
	if (!values) return "skipped";
	const [existing] = await db.select({ id: calendarEvents.id }).from(calendarEvents).where(eq(calendarEvents.externalRef, ref)).limit(1);
	if (existing) {
		// Keep Mailflare-side color; Google wins on content and times.
		await db.update(calendarEvents).set({
			title: values.title,
			description: values.description,
			location: values.location,
			attendees: values.attendees,
			repeat: values.repeat,
			repeatDays: values.repeatDays,
			repeatAnchorDay: values.repeatAnchorDay,
			repeatUntil: values.repeatUntil,
			timeZone: values.timeZone,
			startsAt: values.startsAt,
			endsAt: values.endsAt,
			icalUid: values.icalUid,
			sourceLabel: values.sourceLabel,
			updatedAt: new Date(),
		}).where(eq(calendarEvents.id, existing.id));
		return "updated";
	}
	// The same real-world meeting may already exist as an accepted invite (shared iCal UID).
	if (values.icalUid) {
		const [twin] = await db.select({ id: calendarEvents.id }).from(calendarEvents)
			.where(and(eq(calendarEvents.userId, link.userId), eq(calendarEvents.icalUid, values.icalUid), isNull(calendarEvents.externalRef)))
			.limit(1);
		if (twin) {
			await db.update(calendarEvents).set({ externalRef: ref, source: "google", updatedAt: new Date() }).where(eq(calendarEvents.id, twin.id));
			return "updated";
		}
	}
	await db.insert(calendarEvents).values(values);
	return "inserted";
}

type MappedEvent = typeof calendarEvents.$inferInsert;

function mapGoogleEvent(link: CalendarLink, event: GoogleEvent): MappedEvent | null {
	if (event.status === "cancelled") return null;
	const start = parseGoogleTime(event.start);
	const end = parseGoogleTime(event.end);
	if (!start || !end || end.getTime() <= start.getTime()) return null;
	const title = (event.summary ?? "").trim() || "(no title)";
	const attendees = (event.attendees ?? [])
		.map((attendee) => (attendee.email ?? "").trim())
		.filter((email) => /^\S+@\S+\.\S+$/.test(email));
	const recurrence = parseRecurrence(event.recurrence ?? [], start) ?? { repeat: "none" as const, repeatDays: [], repeatAnchorDay: null, repeatUntil: null };
	return {
		id: newId("evt"),
		userId: link.userId,
		mailboxId: null,
		title,
		description: event.description ?? "",
		location: event.location ?? "",
		attendees: JSON.stringify(attendees),
		color: normalizeCalendarColor("blue"),
		repeat: recurrence.repeat,
		repeatDays: JSON.stringify(recurrence.repeatDays),
		repeatAnchorDay: recurrence.repeatAnchorDay,
		repeatUntil: recurrence.repeatUntil,
		excludedOccurrences: "[]",
		timeZone: event.start?.timeZone ?? null,
		startsAt: start,
		endsAt: end,
		source: "google",
		sourceLabel: link.calendarSummary ?? link.calendarId,
		externalRef: externalRef(link, event.id),
		icalUid: event.iCalUID ?? null,
	};
}

function parseGoogleTime(time: GoogleEvent["start"]): Date | null {
	if (!time) return null;
	if (time.dateTime) return new Date(time.dateTime);
	if (time.date) return new Date(`${time.date}T00:00:00Z`);
	return null;
}

type RecurrenceMapping = {
	repeat: "none" | "daily" | "weekly" | "monthly" | "weekdays";
	repeatDays: number[];
	repeatAnchorDay: number | null;
	repeatUntil: Date | null;
};

const BYDAY_TO_DAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Maps Google's recurrence rules onto Mailflare's repeat model; null means "flatten into occurrences". */
function parseRecurrence(rules: string[], startsAt: Date): RecurrenceMapping | null {
	const mapping: RecurrenceMapping = { repeat: "none", repeatDays: [], repeatAnchorDay: null, repeatUntil: null };
	const rule = rules.map((entry) => entry.replace(/^RRULE:/i, "")).find(Boolean);
	if (!rule) return mapping;
	const parts = new Map(rule.split(";").filter(Boolean).map((part) => {
		const [key, value] = part.split("=");
		return [key.toUpperCase(), value ?? ""] as const;
	}));
	const freq = parts.get("FREQ") ?? "";
	const until = parts.get("UNTIL");
	if (until) {
		const parsed = until.length === 8
			? new Date(`${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}T23:59:59Z`)
			: new Date(until);
		if (!Number.isNaN(parsed.getTime())) mapping.repeatUntil = parsed;
	}
	// Anything Mailflare cannot represent faithfully -> keep as a single event.
	if (parts.has("COUNT") || parts.has("BYSETPOS") || parts.has("RDATE") || parts.has("EXRULE")) return null;
	const interval = Number(parts.get("INTERVAL") ?? 1);
	if (interval !== 1) return null;
	if (freq === "DAILY") {
		mapping.repeat = "daily";
		return mapping;
	}
	if (freq === "WEEKLY") {
		const byDay = (parts.get("BYDAY") ?? "")
			.split(",")
			.filter(Boolean)
			.map((day) => BYDAY_TO_DAY[day.toUpperCase()])
			.filter((day) => Number.isInteger(day));
		if (byDay.length === 0) {
			mapping.repeat = "weekly";
			return mapping;
		}
		if (byDay.length === 5 && new Set(byDay).size === 5 && byDay.every((day) => day >= 1 && day <= 5)) {
			mapping.repeat = "weekdays";
			mapping.repeatDays = normalizeCalendarRepeatDays(byDay);
			return mapping;
		}
		mapping.repeat = "weekly";
		mapping.repeatDays = normalizeCalendarRepeatDays(byDay);
		return mapping;
	}
	if (freq === "MONTHLY") {
		mapping.repeat = "monthly";
		mapping.repeatAnchorDay = startsAt.getUTCDate();
		return mapping;
	}
	return null;
}

async function deleteMissingGoogleEvents(
	db: ReturnType<typeof getDb>,
	link: CalendarLink,
	keptRefs: Set<string>,
): Promise<number> {
	const now = Date.now();
	const rows = await db
		.select({ id: calendarEvents.id, externalRef: calendarEvents.externalRef })
		.from(calendarEvents)
		.where(and(
			eq(calendarEvents.source, "google"),
			like(calendarEvents.externalRef, `google:${link.connectedAccountId}:%`),
			gte(calendarEvents.startsAt, new Date(now - SYNC_WINDOW_PAST_MS)),
			lte(calendarEvents.startsAt, new Date(now + SYNC_WINDOW_FUTURE_MS)),
		));
	let removed = 0;
	for (const row of rows) {
		if (row.externalRef && !keptRefs.has(row.externalRef)) {
			await db.delete(calendarEvents).where(eq(calendarEvents.id, row.id));
			removed += 1;
		}
	}
	return removed;
}

/** Builds a Google recurrence rule from Mailflare's repeat model; null when not representable. */
export function buildGoogleRecurrence(
	repeat: "none" | "daily" | "weekly" | "monthly" | "weekdays",
	repeatDays: number[],
	repeatUntil: Date | null,
): string[] | null {
	const until = repeatUntil ? `;UNTIL=${repeatUntil.toISOString().slice(0, 10).replace(/-/g, "")}` : "";
	if (repeat === "daily") return [`RRULE:FREQ=DAILY${until}`];
	if (repeat === "weekly") return [`RRULE:FREQ=WEEKLY${until}`];
	if (repeat === "weekdays") {
		const days = normalizeCalendarRepeatDays(repeatDays);
		if (!days.length) return null;
		const byDay = Object.entries(BYDAY_TO_DAY).filter(([, day]) => days.includes(day)).map(([code]) => code).join(",");
		return [`RRULE:FREQ=WEEKLY;BYDAY=${byDay}${until}`];
	}
	if (repeat === "monthly") return [`RRULE:FREQ=MONTHLY${until}`];
	return null;
}
