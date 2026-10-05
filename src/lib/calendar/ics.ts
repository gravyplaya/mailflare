/**
 * Minimal RFC 5545 parser for meeting invites (VEVENT + METHOD).
 * Covers what real-world invitation emails contain: folded lines, TZID
 * parameters, UTC/local/date values, and mailto ORGANIZER/ATTENDEE properties.
 */
import { dateFromZonedFields } from "@/lib/time/utils";

export type IcsInvite = {
	method: string | null;
	uid: string;
	summary: string;
	description: string;
	location: string;
	start: Date;
	end: Date | null;
	timeZone: string | null;
	organizerEmail: string | null;
	attendees: string[];
	allDay: boolean;
};

export type IcsReplyStatus = "ACCEPTED" | "DECLINED" | "TENTATIVE";

type IcsLine = { name: string; params: Map<string, string>; value: string };

function unfoldLines(raw: string): string[] {
	const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
	const unfolded: string[] = [];
	for (const line of lines) {
		if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length) {
			unfolded[unfolded.length - 1] += line.slice(1);
			continue;
		}
		unfolded.push(line);
	}
	return unfolded;
}

function parseLine(line: string): IcsLine | null {
	const colon = line.indexOf(":");
	if (colon < 1) return null;
	const head = line.slice(0, colon);
	const value = line.slice(colon + 1);
	const segments = head.split(";");
	const name = segments[0].trim().toUpperCase();
	if (!name) return null;
	const params = new Map<string, string>();
	for (const segment of segments.slice(1)) {
		const [key, ...rest] = segment.split("=");
		if (key && rest.length) params.set(key.trim().toUpperCase(), rest.join("=").replace(/^"|"$/g, ""));
	}
	return { name, params, value };
}

/** Parses ICS date-time/date values. */
function parseIcsDate(value: string, timeZone: string | undefined): { date: Date; allDay: boolean } | null {
	const normalized = value.trim();
	if (/^\d{8}$/.test(normalized)) {
		return { date: new Date(`${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}T00:00:00Z`), allDay: true };
	}
	const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(normalized);
	if (!match) return null;
	const [, year, month, day, hour, minute, second, utcFlag] = match;
	const wall = new Date(0);
	wall.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
	wall.setUTCHours(Number(hour), Number(minute), Number(second), 0);
	if (utcFlag === "Z" || !timeZone) return { date: wall, allDay: false };
	return { date: dateFromZonedFields(wall, timeZone), allDay: false };
}

export function parseIcsInvite(raw: string): IcsInvite | null {
	const lines = unfoldLines(raw);
	const eventStart = lines.findIndex((line) => line.trim().toUpperCase() === "BEGIN:VEVENT");
	const eventEnd = lines.findIndex((line) => line.trim().toUpperCase() === "END:VEVENT");
	if (eventStart < 0 || eventEnd <= eventStart) return null;

	let method: string | null = null;
	let uid = "";
	let summary = "";
	let description = "";
	let location = "";
	let organizerEmail: string | null = null;
	let timeZone: string | null = null;
	let allDay = false;
	let start: Date | null = null;
	let end: Date | null = null;
	const attendees: string[] = [];

	for (let index = 0; index <= eventEnd; index += 1) {
		const parsed = parseLine(lines[index]);
		if (!parsed) continue;
		if (parsed.name === "METHOD") {
			method = parsed.value.trim().toUpperCase();
			continue;
		}
		if (index < eventStart) continue;
		switch (parsed.name) {
			case "UID":
				uid = parsed.value.trim();
				break;
			case "SUMMARY":
				summary = parsed.value.trim();
				break;
			case "DESCRIPTION":
				description = parsed.value;
				break;
			case "LOCATION":
				location = parsed.value;
				break;
			case "DTSTART": {
				const zone = parsed.params.get("TZID");
				const parsedDate = parseIcsDate(parsed.value, zone ?? undefined);
				if (parsedDate) {
					start = parsedDate.date;
					timeZone = zone ?? null;
					allDay = parsedDate.allDay;
				}
				break;
			}
			case "DTEND": {
				const parsedDate = parseIcsDate(parsed.value, parsed.params.get("TZID") ?? undefined);
				if (parsedDate) end = parsedDate.date;
				break;
			}
			case "ORGANIZER": {
				const email = extractMailto(parsed.value);
				if (email) organizerEmail = email;
				break;
			}
			case "ATTENDEE": {
				const email = extractMailto(parsed.value);
				if (email) attendees.push(email);
				break;
			}
			default:
				break;
		}
	}
	if (!uid || !start) return null;
	return {
		method,
		uid,
		summary: summary || "(no title)",
		description,
		location,
		start,
		end,
		timeZone,
		organizerEmail,
		attendees,
		allDay,
	};
}

function extractMailto(value: string): string | null {
	const email = value.replace(/^mailto:/i, "").split(";")[0].trim();
	return /^\S+@\S+\.\S+$/.test(email) ? email.toLowerCase() : null;
}

/** Builds an iMIP reply (METHOD:REPLY) telling the organizer how you responded. */
export function buildIcsReply(input: {
	uid: string;
	summary: string;
	start: Date;
	end: Date | null;
	organizerEmail: string;
	attendeeEmail: string;
	attendeeName: string | null;
	status: IcsReplyStatus;
}): string {
	const attendeePart = input.attendeeName ? `;CN=${escapeIcsText(input.attendeeName)}` : "";
	const stamp = toIcsUtc(new Date());
	const start = input.start ? toIcsUtc(input.start) : null;
	const end = input.end ? toIcsUtc(input.end) : null;
	return [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Mailflare//Invite Reply//EN",
		"METHOD:REPLY",
		"BEGIN:VEVENT",
		`UID:${input.uid}`,
		`DTSTAMP:${stamp}`,
		start ? `DTSTART:${start}` : null,
		end ? `DTEND:${end}` : null,
		`SUMMARY:${escapeIcsText(input.summary)}`,
		`ORGANIZER;mailto:${input.organizerEmail}`,
		`ATTENDEE;PARTSTAT=${input.status}${attendeePart}:mailto:${input.attendeeEmail}`,
		input.status === "DECLINED" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
		"END:VEVENT",
		"END:VCALENDAR",
	].filter(Boolean).join("\r\n");
}

function toIcsUtc(date: Date): string {
	return `${date.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

function escapeIcsText(value: string): string {
	return value.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}
