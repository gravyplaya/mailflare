import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { fetchGmailLabels, isComposioConfigured } from "@/lib/composio/client";

export async function GET(request: Request) {
	const env = getEnv();
	await requireUser(env, request);
	const connectedAccountId = new URL(request.url).searchParams.get("connectedAccountId")?.trim() ?? "";
	if (!isComposioConfigured(env)) {
		return NextResponse.json({ error: "Composio is not configured on this instance" }, { status: 400 });
	}
	if (!connectedAccountId) {
		return NextResponse.json({ error: "Connected account ID is required" }, { status: 400 });
	}

	try {
		const labels = await fetchGmailLabels(env, connectedAccountId);
		return NextResponse.json({ labels });
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Unable to list Gmail labels" },
			{ status: 502 },
		);
	}
}
