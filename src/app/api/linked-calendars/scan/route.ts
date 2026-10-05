import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { isComposioConfigured } from "@/lib/composio/client";
import { listGoogleCalendarConnections, registerLinkedCalendar } from "@/lib/calendar/calendar-links";

/**
 * Registers every ACTIVE googlecalendar connection in Composio that Mailflare
 * does not know about yet. Called right after the user consents on
 * connect.composio.dev (the consent page cannot call back into Mailflare).
 */
export async function POST(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	if (!isComposioConfigured(env)) {
		return NextResponse.json({ error: "Composio is not configured on this instance" }, { status: 400 });
	}
	const connections = await listGoogleCalendarConnections(env);
	if (!connections.ok) {
		return NextResponse.json({ error: connections.error }, { status: connections.status });
	}
	let registered = 0;
	const linked: { connectedAccountId: string; label: string | null }[] = [];
	for (const connection of connections.data) {
		try {
			const outcome = await registerLinkedCalendar(env, user, connection.connectedAccountId);
			if (outcome.registered) registered += 1;
			linked.push({ connectedAccountId: connection.connectedAccountId, label: outcome.label });
		} catch {
			// Skip connections that fail verification; the rest still register.
		}
	}
	return NextResponse.json({ registered, linked });
}
