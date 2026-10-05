import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { linkedCalendars } from "@/db/schema";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { registerLinkedCalendar } from "@/lib/calendar/calendar-links";
import { readJsonBody } from "@/lib/http/request";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	const links = await getDb(env)
		.select({
			id: linkedCalendars.id,
			connectedAccountId: linkedCalendars.connectedAccountId,
			calendarId: linkedCalendars.calendarId,
			label: linkedCalendars.calendarSummary,
			lastSyncedAt: linkedCalendars.lastSyncedAt,
			lastError: linkedCalendars.lastError,
		})
		.from(linkedCalendars)
		.where(eq(linkedCalendars.userId, user.id))
		.orderBy(desc(linkedCalendars.createdAt));
	return NextResponse.json({ calendars: links, configured: Boolean(env.COMPOSIO_API_KEY) });
}

export async function POST(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	if (!env.COMPOSIO_API_KEY) {
		return NextResponse.json({ error: "Composio is not configured on this instance" }, { status: 400 });
	}
	let body: { connectedAccountId?: string };
	try {
		body = await readJsonBody(request, 4 * 1024);
	} catch {
		return NextResponse.json({ error: "Invalid request" }, { status: 400 });
	}
	const connectedAccountId = body.connectedAccountId?.trim() ?? "";
	if (!connectedAccountId) {
		return NextResponse.json({ error: "Connected account ID is required" }, { status: 400 });
	}
	try {
		const outcome = await registerLinkedCalendar(env, user, connectedAccountId);
		return NextResponse.json(outcome);
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to register the calendar" }, { status: 502 });
	}
}

export async function DELETE(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	const id = new URL(request.url).searchParams.get("id") ?? "";
	if (!id) {
		return NextResponse.json({ error: "Calendar link id is required" }, { status: 400 });
	}
	const deleted = await getDb(env)
		.delete(linkedCalendars)
		.where(eq(linkedCalendars.id, id))
		.returning({ userId: linkedCalendars.userId });
	if (!deleted.length || deleted[0].userId !== user.id) {
		return NextResponse.json({ error: "Calendar link not found" }, { status: 404 });
	}
	return NextResponse.json({ ok: true });
}
