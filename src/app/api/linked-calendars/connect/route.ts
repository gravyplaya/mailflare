import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { isComposioConfigured } from "@/lib/composio/client";
import { createGoogleCalendarConnectLink } from "@/lib/calendar/calendar-links";

/** Starts the Google Calendar connect flow: returns the Composio consent URL. */
export async function POST(request: Request) {
	const env = getEnv();
	await requireUser(env, request);
	if (!isComposioConfigured(env)) {
		return NextResponse.json({ error: "Composio is not configured on this instance" }, { status: 400 });
	}
	const link = await createGoogleCalendarConnectLink(env);
	if (!link.ok) {
		return NextResponse.json({ error: link.error }, { status: link.status });
	}
	return NextResponse.json({ redirectUrl: link.redirectUrl, connectedAccountId: link.connectedAccountId });
}
