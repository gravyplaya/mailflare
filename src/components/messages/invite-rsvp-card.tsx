"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CalendarX, CalendarClock, MapPin, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth/client";
import { formatUserDate } from "@/lib/time/utils";
import type { MessageInvite } from "@/app/(dashboard)/inbox/[messageId]/types";

type RsvpStatus = "accepted" | "declined" | "tentative";

export function InviteRsvpCard({ messageId, invite }: { messageId: string; invite: MessageInvite }) {
	const router = useRouter();
	const [status, setStatus] = useState<RsvpStatus | null>(invite.responded ? "accepted" : null);
	const [pending, setPending] = useState<RsvpStatus | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function respond(next: RsvpStatus) {
		setPending(next);
		setError(null);
		try {
			const response = await authFetch(`/api/messages/${encodeURIComponent(messageId)}/rsvp`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: next }),
			});
			const data = (await response.json()) as { ok?: boolean; error?: string };
			if (!response.ok) throw new Error(data.error ?? "Could not send your response");
			setStatus(next);
			router.refresh();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not send your response");
		} finally {
			setPending(null);
		}
	}

	const start = new Date(invite.startsAt);
	const end = invite.endsAt ? new Date(invite.endsAt) : null;
	const label = status === "accepted"
		? "You accepted this invitation"
		: status === "declined"
			? "You declined this invitation"
			: status === "tentative"
				? "You replied maybe to this invitation"
				: null;

	return (
		<div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4" data-testid="invite-rsvp">
			<div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
				<CalendarCheck className="h-4 w-4 text-blue-700" />
				Meeting invite{invite.organizerEmail ? ` from ${invite.organizerEmail}` : ""}
			</div>
			<p className="mt-1 text-sm font-medium text-neutral-800">{invite.summary}</p>
			<div className="mt-1 space-y-0.5 text-xs text-neutral-600">
				<p className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{formatUserDate(start, { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}{end && !invite.allDay ? ` – ${formatUserDate(end, { hour: "numeric", minute: "2-digit" })}` : ""}</p>
				{invite.location && <p className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{invite.location}</p>}
			</div>
			{label ? (
				<p className="mt-3 text-sm font-medium text-blue-700">{label}</p>
			) : (
				<div className="mt-3 flex flex-wrap gap-2">
					<Button type="button" size="sm" disabled={pending !== null} onClick={() => void respond("accepted")}>
						<CalendarCheck className="h-4 w-4" />
						{pending === "accepted" ? "Responding…" : "Accept"}
					</Button>
					<Button type="button" size="sm" variant="outline" disabled={pending !== null} onClick={() => void respond("tentative")}>
						<CalendarClock className="h-4 w-4" />
						{pending === "tentative" ? "Responding…" : "Maybe"}
					</Button>
					<Button type="button" size="sm" variant="outline" disabled={pending !== null} onClick={() => void respond("declined")}>
						<CalendarX className="h-4 w-4" />
						{pending === "declined" ? "Responding…" : "Decline"}
					</Button>
				</div>
			)}
			{error && <p className="mt-2 text-xs text-red-600">{error}</p>}
		</div>
	);
}
