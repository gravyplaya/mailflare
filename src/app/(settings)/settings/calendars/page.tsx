"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarPlus2, CheckCircle2, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth/client";
import { formatUserDate } from "@/lib/time/utils";

type LinkedCalendar = {
	id: string;
	connectedAccountId: string;
	calendarId: string;
	label: string | null;
	lastSyncedAt: string | null;
	lastError: string | null;
};

export default function SettingsCalendarsPage() {
	const [calendars, setCalendars] = useState<LinkedCalendar[]>([]);
	const [configured, setConfigured] = useState(true);
	const [loading, setLoading] = useState(true);
	const [connecting, setConnecting] = useState(false);
	const [scanning, setScanning] = useState(false);
	const [syncingId, setSyncingId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const response = await authFetch("/api/linked-calendars");
			const data = (await response.json()) as { calendars?: LinkedCalendar[]; configured?: boolean; error?: string };
			if (!response.ok) throw new Error(data.error ?? "Unable to load calendar links");
			setCalendars(data.calendars ?? []);
			setConfigured(data.configured ?? true);
			setError(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Unable to load calendar links");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const response = await authFetch("/api/linked-calendars");
				const data = (await response.json()) as { calendars?: LinkedCalendar[]; configured?: boolean; error?: string };
				if (!response.ok) throw new Error(data.error ?? "Unable to load calendar links");
				if (!cancelled) {
					setCalendars(data.calendars ?? []);
					setConfigured(data.configured ?? true);
					setError(null);
				}
			} catch (cause) {
				if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load calendar links");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [load]);

	async function connect() {
		setConnecting(true);
		setError(null);
		setNotice("Complete the Google sign-in in the tab that opens, then Mailflare will pick it up automatically.");
		try {
			const response = await authFetch("/api/linked-calendars/connect", { method: "POST" });
			const data = (await response.json()) as { redirectUrl?: string; error?: string };
			if (!response.ok || !data.redirectUrl) throw new Error(data.error ?? "Could not start the connect flow");
			window.open(data.redirectUrl, "_blank", "noopener");
			await scan();
		} catch (cause) {
			setNotice(null);
			setError(cause instanceof Error ? cause.message : "Could not start the connect flow");
		} finally {
			setConnecting(false);
		}
	}

	async function scan() {
		setScanning(true);
		setError(null);
		try {
			// Poll briefly: the consent flow finishes in the other tab.
			for (let attempt = 0; attempt < 5; attempt += 1) {
				const response = await authFetch("/api/linked-calendars/scan", { method: "POST" });
				const data = (await response.json()) as { registered?: number; error?: string };
				if (!response.ok) throw new Error(data.error ?? "Could not scan for new calendars");
				if ((data.registered ?? 0) > 0) break;
				if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 4000));
			}
			await load();
			setNotice(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not scan for new calendars");
		} finally {
			setScanning(false);
		}
	}

	async function syncNow(id: string) {
		setSyncingId(id);
		setError(null);
		try {
			const response = await authFetch("/api/linked-calendars/sync", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id }),
			});
			const data = (await response.json()) as { imported?: number; updated?: number; removed?: number; error?: string };
			if (!response.ok) throw new Error(data.error ?? "Sync failed");
			setNotice(`Synced: ${data.imported ?? 0} new, ${data.updated ?? 0} updated, ${data.removed ?? 0} removed.`);
			await load();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Sync failed");
		} finally {
			setSyncingId(null);
		}
	}

	async function disconnect(id: string) {
		setError(null);
		try {
			const response = await authFetch(`/api/linked-calendars?id=${encodeURIComponent(id)}`, { method: "DELETE" });
			if (!response.ok) {
				const data = (await response.json()) as { error?: string };
				throw new Error(data.error ?? "Could not remove the calendar link");
			}
			await load();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not remove the calendar link");
		}
	}

	return (
		<div className="space-y-6">
			<section className="space-y-4">
				<div>
					<h2 className="text-xl font-semibold text-neutral-900">Calendars</h2>
					<p className="mt-1 text-sm text-neutral-500">
						Connect Google Calendars to sync their events into Mailflare. Synced events also block
						bookable time, and new events can be saved to any connected calendar.
					</p>
				</div>

				{!configured && (
					<p className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
						Composio is not configured on this instance. Add a <code>COMPOSIO_API_KEY</code> to
						enable calendar syncing.
					</p>
				)}
				{error && (
					<p className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
				)}
				{notice && (
					<p className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">{notice}</p>
				)}

				<div className="overflow-hidden rounded-3xl bg-white shadow-sm">
					{loading ? (
						<p className="p-6 text-sm text-neutral-500">Loading…</p>
					) : calendars.length === 0 ? (
						<p className="p-6 text-sm text-neutral-500">
							No calendars connected yet. Connect one to start syncing.
						</p>
					) : (
						<ul className="divide-y divide-neutral-100">
							{calendars.map((calendar) => (
								<li key={calendar.id} className="flex flex-wrap items-center gap-3 p-4 sm:px-6">
									<CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-medium text-neutral-900">
											{calendar.label ?? calendar.connectedAccountId}
										</p>
										<p className="truncate text-xs text-neutral-500">
											{calendar.lastError
												? <span className="inline-flex items-center gap-1 text-red-600"><TriangleAlert className="h-3.5 w-3.5" />{calendar.lastError}</span>
												: calendar.lastSyncedAt
													? `Last synced ${formatUserDate(new Date(calendar.lastSyncedAt), { dateStyle: "medium", timeStyle: "short" })}`
													: "Not synced yet"}
										</p>
									</div>
									<div className="flex items-center gap-2">
										<Button type="button" variant="outline" size="sm" disabled={syncingId !== null} onClick={() => void syncNow(calendar.id)}>
											<RefreshCw className={`h-4 w-4 ${syncingId === calendar.id ? "animate-spin" : ""}`} />
											{syncingId === calendar.id ? "Syncing…" : "Sync now"}
										</Button>
										<Button type="button" variant="outline" size="sm" onClick={() => void disconnect(calendar.id)} aria-label={`Remove ${calendar.label ?? calendar.id}`}>
											<Trash2 className="h-4 w-4" />
											Remove
										</Button>
									</div>
								</li>
							))}
						</ul>
					)}
				</div>

				{configured && (
					<div className="flex flex-wrap gap-2">
						<Button type="button" onClick={() => void connect()} disabled={connecting || scanning}>
							<CalendarPlus2 className="h-4 w-4" />
							{connecting ? "Starting…" : "Connect Google Calendar"}
						</Button>
						<Button type="button" variant="outline" onClick={() => void scan()} disabled={scanning}>
							<RefreshCw className={`h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
							{scanning ? "Checking for new connections…" : "Scan for newly connected calendars"}
						</Button>
					</div>
				)}
				<p className="text-xs leading-5 text-neutral-500">
					Removing a calendar link stops syncing and removes its synced events from Mailflare; the
					connection itself stays in your Composio dashboard.
				</p>
			</section>
		</div>
	);
}
