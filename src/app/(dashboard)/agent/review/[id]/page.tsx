"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { authFetch } from "@/lib/auth/client";
import { SendReview } from "@/components/agent/send-review";
import type { AgentReviewResponse } from "@/components/agent/send-review-types";

export default function AgentReviewPage() {
	const { id } = useParams<{ id: string }>();
	const router = useRouter();
	const [request, setRequest] = useState<AgentReviewResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		void authFetch(`/api/agent/approvals/${id}`).then(async (response) => {
			const data = await response.json() as AgentReviewResponse;
			if (!response.ok) throw new Error(data.error || "Could not load review");
			setRequest(data);
		}).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load review"));
	}, [id]);
	return <div className="p-8">
		<h1 className="text-2xl font-semibold">AI draft review</h1>
		{error && <p className="mt-4 text-red-600">{error}</p>}
		{!error && !request && <p className="mt-4">Loading review…</p>}
		{request && (request.status !== "pending" || request.stale || !request.snapshot) && <p className="mt-4">This review is {request.stale ? "out of date" : request.status}. Open the draft and request a new review if needed.</p>}
		{request?.status === "pending" && !request.stale && request.snapshot && <SendReview approvalId={id} snapshot={request.snapshot} onClose={() => router.push("/drafts")} onSent={() => router.push("/sent")} />}
	</div>;
}
