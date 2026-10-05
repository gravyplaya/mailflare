import type { CalendarRepeat } from "@/lib/calendar/types";

export type CalendarEventInput = {
	title: string;
	description?: string;
	location?: string;
	attendees?: string[];
	color?: string;
	repeat?: CalendarRepeat;
	repeatDays?: number[];
	repeatAnchorDay?: number;
	timeZone?: string;
	effectiveFrom?: string;
	moveOccurrenceToPast?: boolean;
	startsAt: string;
	endsAt: string;
	mailboxId?: string | null;
	from?: string;
	/** Connected account (ca_...) of the linked Google calendar to also create this event on. */
	googleCalendarId?: string;
};
