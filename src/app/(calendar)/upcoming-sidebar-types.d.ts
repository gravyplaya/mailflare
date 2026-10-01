import type { CalendarEvent } from "./calendar/types";

export type UpcomingSidebarProps = {
	events?: CalendarEvent[];
	onSelect?: (event: CalendarEvent) => void;
};
