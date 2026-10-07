"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlarmClock, Check, X } from "lucide-react";
import { usePageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth/client";
import { formatUserDate } from "@/lib/time/utils";

type FollowUpRow = {
	id: string;
	messageId: string;
	mailboxId: string;
	dueAt: string;
	triggeredAt: string | null;
	createdAt: string;
	subject: string | null;
	toAddr: string;
	threadId: string | null;
};

export default function FollowUpsPage() {
	const [followUps, setFollowUps] = useState<FollowUpRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [pendingId, setPendingId] = useState<string | null>(null);
	usePageLoading(loading);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const response = await authFetch("/api/follow-ups");
			const data = (await response.json()) as { followUps?: FollowUpRow[] };
			setFollowUps(data.followUps ?? []);
		} catch {
			setFollowUps([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function dismiss(id: string) {
		setPendingId(id);
		try {
			const response = await authFetch(`/api/follow-ups/${id}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "dismiss" }),
			});
			if (!response.ok) throw new Error("Could not dismiss");
			setFollowUps((current) => current.filter((item) => item.id !== id));
			window.dispatchEvent(new Event("mailflare:messages-changed"));
		} finally {
			setPendingId(null);
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-6">
				<h1 className="text-lg font-semibold text-neutral-900">Follow-ups</h1>
				<span className="text-xs text-neutral-500">
					{followUps.length === 0 ? "" : `${followUps.length} awaiting reply`}
				</span>
			</div>
			<div className="min-h-0 flex-1 divide-y divide-neutral-100 overflow-y-auto overscroll-contain">
				{!loading && followUps.length === 0 && (
					<p className="px-6 py-4 text-sm text-neutral-500">
						No follow-ups right now. Schedule one when sending: “remind me if no reply”.
					</p>
				)}
				{followUps.map((item) => (
					<div key={item.id} className="flex items-center gap-4 px-6 py-4">
						<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
							<AlarmClock className="h-4 w-4" />
						</div>
						<Link href={`/sent/${item.messageId}`} className="min-w-0 flex-1">
							<p className="truncate text-sm font-semibold text-neutral-900">
								{item.subject ?? "(no subject)"}
							</p>
							<p className="mt-0.5 truncate text-xs text-neutral-500">
								No reply to {item.toAddr} — due since {formatUserDate(new Date(item.triggeredAt ?? item.dueAt), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
							</p>
						</Link>
						<div className="flex shrink-0 items-center gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={pendingId === item.id}
								onClick={() => void dismiss(item.id)}
							>
								<Check className="mr-1 h-4 w-4" />
								Handled
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={pendingId === item.id}
								aria-label="Dismiss follow-up"
								onClick={() => void dismiss(item.id)}
							>
								<X className="h-4 w-4" />
							</Button>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
