import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { linkedCalendars } from "@/db/schema";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { runGoogleCalendarSync } from "@/lib/calendar/google-sync";

/** Runs an immediate sync for one linked calendar. */
export async function POST(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	let body: { id?: string };
	try {
		body = (await request.json()) as { id?: string };
	} catch {
		return NextResponse.json({ error: "Invalid request" }, { status: 400 });
	}
	const id = body.id?.trim() ?? "";
	if (!id) {
		return NextResponse.json({ error: "Calendar link id is required" }, { status: 400 });
	}
	const db = getDb(env);
	const [link] = await db.select({ connectedAccountId: linkedCalendars.connectedAccountId }).from(linkedCalendars)
		.where(and(eq(linkedCalendars.id, id), eq(linkedCalendars.userId, user.id)))
		.limit(1);
	if (!link) {
		return NextResponse.json({ error: "Calendar link not found" }, { status: 404 });
	}
	const results = await runGoogleCalendarSync(env, { connectedAccountId: link.connectedAccountId });
	const result = results[0];
	if (!result) {
		return NextResponse.json({ error: "Sync did not run" }, { status: 500 });
	}
	if (result.error) {
		return NextResponse.json({ error: result.error }, { status: 502 });
	}
	return NextResponse.json({ ok: true, imported: result.imported, updated: result.updated, removed: result.removed });
}
