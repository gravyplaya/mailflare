"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { usePageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth/client";
import { formatMessageListTimestamp } from "@/components/messages/utils";
import { getEmailAddress } from "@/lib/email/address";

type GatekeeperMessage = {
	id: string;
	mailboxId: string | null;
	fromAddr: string;
	subject: string | null;
	snippet: string | null;
	createdAt: string;
};

type SenderGroup = {
	address: string;
	messages: GatekeeperMessage[];
};

export function GatekeeperView() {
	const { selectedMailbox, isLoading: mailboxesLoading } = useSelectedMailbox();
	const [messages, setMessages] = useState<GatekeeperMessage[]>([]);
	const [loading, setLoading] = useState(true);
	const [pendingSender, setPendingSender] = useState<string | null>(null);
	usePageLoading(mailboxesLoading || loading);

	const load = useCallback(async (mailboxId?: string | null) => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (mailboxId) params.set("mailboxId", mailboxId);
			const query = params.toString();
			const response = await authFetch(`/api/gatekeeper${query ? `?${query}` : ""}`);
			const data = (await response.json()) as { messages?: GatekeeperMessage[] };
			setMessages(data.messages ?? []);
		} catch {
			setMessages([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (mailboxesLoading) return;
		void load(selectedMailbox?.id);
	}, [load, mailboxesLoading, selectedMailbox?.id]);

	const groups = useMemo<SenderGroup[]>(() => {
		const bySender = new Map<string, GatekeeperMessage[]>();
		for (const message of messages) {
			const address = getEmailAddress(message.fromAddr) || message.fromAddr;
			const list = bySender.get(address) ?? [];
			list.push(message);
			bySender.set(address, list);
		}
		return Array.from(bySender.entries())
			.map(([address, list]) => ({ address, messages: list }))
			.sort((a, b) => {
				const aTime = new Date(a.messages[0].createdAt).getTime();
				const bTime = new Date(b.messages[0].createdAt).getTime();
				return bTime - aTime;
			});
	}, [messages]);

	async function run(action: "approve" | "block", address: string) {
		setPendingSender(address);
		try {
			const response = await authFetch("/api/gatekeeper", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action, address }),
			});
			if (!response.ok) throw new Error("Action failed");
			setMessages((current) => current.filter((message) => (getEmailAddress(message.fromAddr) || message.fromAddr) !== address));
			window.dispatchEvent(new Event("mailflare:messages-changed"));
		} finally {
			setPendingSender(null);
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-6">
				<h1 className="text-lg font-semibold text-neutral-900">Gatekeeper</h1>
				<span className="text-xs text-neutral-500">
					{groups.length === 0 ? "" : `${groups.length} sender${groups.length === 1 ? "" : "s"} waiting`}
				</span>
			</div>
			<div className="min-h-0 flex-1 divide-y divide-neutral-100 overflow-y-auto overscroll-contain">
				{!loading && groups.length === 0 && (
					<p className="px-6 py-4 text-sm text-neutral-500">
						No new senders are waiting. Mail from senders you have not approved yet appears here.
					</p>
				)}
				{groups.map((group) => (
					<div key={group.address} className="px-6 py-4">
						<div className="flex items-center justify-between gap-3">
							<div className="min-w-0">
								<p className="truncate text-sm font-semibold text-neutral-900">{group.address}</p>
								<p className="mt-0.5 text-xs text-neutral-500">
									{group.messages.length} message{group.messages.length === 1 ? "" : "s"} held
								</p>
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={pendingSender === group.address}
									onClick={() => void run("approve", group.address)}
								>
									<Check className="mr-1 h-4 w-4" />
									Accept
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={pendingSender === group.address}
									onClick={() => void run("block", group.address)}
								>
									<X className="mr-1 h-4 w-4" />
									Block
								</Button>
							</div>
						</div>
						<div className="mt-2 space-y-1">
							{group.messages.map((message) => (
								<Link
									key={message.id}
									href={`/gatekeeper/${message.id}`}
									className="block rounded-lg px-3 py-2 hover:bg-neutral-50"
								>
									<span className="flex items-baseline justify-between gap-3">
										<span className="truncate text-sm text-neutral-800">
											{message.subject ?? "(no subject)"}
										</span>
										<span className="shrink-0 text-[11px] text-neutral-400">
											{formatMessageListTimestamp(message.createdAt)}
										</span>
									</span>
									{message.snippet && (
										<span className="mt-0.5 block truncate text-xs text-neutral-500">
											{message.snippet}
										</span>
									)}
								</Link>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
