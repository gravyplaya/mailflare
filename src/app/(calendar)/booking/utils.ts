import type { BookingEvent, BookingForm, BookingHost, BookingHostMatch } from "./types";
import { parseBookingTimeRanges } from "@/lib/booking/utils";
import { timeToMinutes } from "@/lib/booking/utils";
import type { BookingTimeRange } from "@/lib/booking/types";
import { DEFAULT_FOLDER_COLOR } from "@/lib/folders/colors";
import { normalizeCalendarColor } from "@/lib/calendar/colors";
import { slugifyBookingName } from "@/lib/booking/utils";
import { parseBookingHostIds } from "@/lib/booking/hosts";

export const WEEKDAYS = [
	{ value: 0, short: "Sun", label: "Sunday" },
	{ value: 1, short: "Mon", label: "Monday" },
	{ value: 2, short: "Tue", label: "Tuesday" },
	{ value: 3, short: "Wed", label: "Wednesday" },
	{ value: 4, short: "Thu", label: "Thursday" },
	{ value: 5, short: "Fri", label: "Friday" },
	{ value: 6, short: "Sat", label: "Saturday" },
];

export function emptyBookingForm(timeZone: string, currentUserId: string): BookingForm {
	return { name: "", slug: "", description: "", color: DEFAULT_FOLDER_COLOR, hostIds: [currentUserId], durationMinutes: 30, location: "", weekdays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", timeRanges: [{ startTime: "09:00", endTime: "17:00" }], timeZone, enabled: true };
}

export function formFromEvent(event: BookingEvent): BookingForm {
	let weekdays: number[] = [];
	try { weekdays = JSON.parse(event.weekdays) as number[]; } catch { /* An invalid saved schedule remains editable. */ }
	return { name: event.name, slug: event.slug, description: event.description ?? "", color: normalizeCalendarColor(event.color), hostIds: parseBookingHostIds(event.hostIds, event.userId), durationMinutes: event.durationMinutes, location: event.location, weekdays, startTime: event.startTime, endTime: event.endTime, timeRanges: parseBookingTimeRanges(event.timeRanges, { startTime: event.startTime, endTime: event.endTime }), timeZone: event.timeZone, enabled: event.enabled };
}

export function bookingFormWithName(form: BookingForm, name: string): BookingForm {
	return { ...form, name, slug: !form.slug || form.slug === slugifyBookingName(form.name) ? slugifyBookingName(name) : form.slug };
}

export function matchBookingHost(hosts: BookingHost[], value: string): BookingHostMatch {
	const query = value.trim().toLowerCase();
	if (!query) return { host: null, error: "Enter a name or email." };
	if (query.includes("@")) {
		const host = hosts.find((item) => item.email.toLowerCase() === query);
		return host ? { host, error: "" } : { host: null, error: "Invalid email" };
	}
	const matches = hosts.filter((item) => item.name.toLowerCase() === query || item.name.toLowerCase().startsWith(query));
	if (matches.length === 1) return { host: matches[0], error: "" };
	return { host: null, error: matches.length ? "More than one user matches. Enter their email address." : "No user with that name is in your user list." };
}

export function durationLabel(minutes: number): string {
	return minutes === 60 ? "1 hour" : minutes > 60 && minutes % 60 === 0 ? `${minutes / 60} hours` : `${minutes} min`;
}

export function availabilityLabel(event: BookingEvent): string {
	const { weekdays } = formFromEvent(event);
	if (!weekdays.length) return "No days selected";
	const days = weekdays.map((day) => WEEKDAYS.find((item) => item.value === day)?.short).filter(Boolean).join(", ");
	const ranges = parseBookingTimeRanges(event.timeRanges, { startTime: event.startTime, endTime: event.endTime });
	return `${days} · ${ranges.map((range) => `${range.startTime}–${range.endTime}`).join(", ")}`;
}

export function formAvailabilityLabel(form: BookingForm): string {
	if (!form.weekdays.length) return "No days selected";
	const days = form.weekdays.map((day) => WEEKDAYS.find((item) => item.value === day)?.short).filter(Boolean).join(", ");
	return `${days} · ${form.timeRanges.length === 1 ? `${form.timeRanges[0].startTime}–${form.timeRanges[0].endTime}` : `${form.timeRanges.length} time windows`}`;
}

export function nextBookingTimeRange(ranges: BookingTimeRange[], durationMinutes: number): BookingTimeRange {
	const length = Math.ceil(Math.max(durationMinutes, 60) / 15) * 15;
	const occupied = ranges.map((range) => ({ start: timeToMinutes(range.startTime), end: timeToMinutes(range.endTime) })).sort((a, b) => a.start - b.start);
	let start = occupied.length ? occupied[occupied.length - 1].end : 9 * 60;
	if (start + length > 23 * 60 + 45) {
		start = 0;
		for (const range of occupied) {
			if (start + length <= range.start) break;
			start = Math.max(start, range.end);
		}
	}
	const end = Math.min(start + length, 23 * 60 + 45);
	const format = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
	return { startTime: format(start), endTime: format(end) };
}
