"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { SidebarResizeBoundary } from "@/components/sidebar-resize-boundary";
import { useSidebar } from "@/components/sidebar-state";
import { authFetch } from "@/lib/auth/client";
import { normalizeCalendarColor } from "@/lib/calendar/colors";
import type { CalendarEvent } from "./calendar/types";
import { addDays, expandCalendarEvents, formatEventRange, groupUpcomingEvents, startOfDay, takeUpcomingGroups, UPCOMING_BATCH_SIZE } from "./calendar/utils";
import type { UpcomingSidebarProps } from "./upcoming-sidebar-types";

export function UpcomingSidebar({ events, onSelect }: UpcomingSidebarProps) {
	const { minimal } = useSidebar();
	const router = useRouter();
	const [loadedEvents, setLoadedEvents] = useState<CalendarEvent[]>([]);
	const [loadError, setLoadError] = useState(false);
	const [visibleCount, setVisibleCount] = useState(UPCOMING_BATCH_SIZE);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const sentinelRef = useRef<HTMLDivElement | null>(null);
	const today = useMemo(() => startOfDay(new Date()), []);
	const shownEvents = events ?? loadedEvents;
	const groups = useMemo(() => groupUpcomingEvents(shownEvents, today), [shownEvents, today]);
	const total = useMemo(() => groups.reduce((count, group) => count + group.events.length, 0), [groups]);
	const visibleGroups = useMemo(() => takeUpcomingGroups(groups, visibleCount), [groups, visibleCount]);

	useEffect(() => {
		if (events !== undefined) return;
		let active = true;
		const end = addDays(today, 90);
		void authFetch(`/api/calendar/events?start=${today.toISOString()}&end=${end.toISOString()}`)
			.then(async (response) => {
				if (!response.ok) throw new Error();
				return response.json() as Promise<{ events?: CalendarEvent[] }>;
			})
			.then((data) => { if (active) setLoadedEvents(expandCalendarEvents(data.events ?? [], today, end)); })
			.catch(() => { if (active) setLoadError(true); });
		return () => { active = false; };
	}, [events, today]);

	useEffect(() => { setVisibleCount(UPCOMING_BATCH_SIZE); }, [shownEvents]);

	useEffect(() => {
		if (minimal || visibleCount >= total || !scrollRef.current || !sentinelRef.current) return;
		const observer = new IntersectionObserver(([entry]) => {
			if (!entry?.isIntersecting) return;
			observer.disconnect();
			setVisibleCount((count) => Math.min(count + UPCOMING_BATCH_SIZE, total));
		}, { root: scrollRef.current, rootMargin: "0px 0px 100px 0px" });
		observer.observe(sentinelRef.current);
		return () => observer.disconnect();
	}, [minimal, total, visibleCount]);

	return <aside className={clsx("relative shrink-0 rounded-t-3xl bg-white transition-[width,max-height] duration-200 ease-in-out motion-reduce:transition-none lg:h-full lg:max-h-none", minimal ? "w-0 max-h-0" : "w-full max-h-[36vh] lg:w-[var(--sidebar-width)]")} aria-hidden={minimal}>
		{!minimal && <div ref={scrollRef} className="h-full overflow-y-auto overscroll-contain rounded-t-3xl px-5 py-5">
			{groups.length === 0 ? <div><h2 className="text-lg font-semibold text-neutral-900">Upcoming</h2><p className="mt-4 text-sm text-neutral-400">{loadError ? "Could not load upcoming events." : "No upcoming events."}</p></div> : visibleGroups.map((group) => <section key={group.key} className="mb-6 last:mb-0"><h2 className="sticky -top-5 z-10 -mx-5 mb-2 bg-white px-5 py-2 text-base font-semibold text-neutral-900">{group.label}</h2><div className="space-y-2">{group.events.map((event) => <button key={event.id} type="button" onClick={() => onSelect ? onSelect(event) : router.push(`/calendar?event=${encodeURIComponent(event.id)}`)} className="group flex w-full items-start gap-3 text-left"><span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-white ring-1 ring-neutral-200" style={{ backgroundColor: normalizeCalendarColor(event.color) }} /><span className="min-w-0"><span className="block truncate text-sm text-neutral-700 group-hover:text-neutral-950">{event.title}</span><span className="block text-xs text-neutral-400">{formatEventRange(event)}</span></span></button>)}</div></section>)}
			{visibleCount < total && <div ref={sentinelRef} aria-hidden="true" className="h-1" />}
		</div>}
		{!minimal && <div className="hidden lg:block"><SidebarResizeBoundary /></div>}
	</aside>;
}
