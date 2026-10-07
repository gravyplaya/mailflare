import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { contacts, users } from "@/db/schema";
import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";

export async function GET(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	return NextResponse.json({ enabled: auth.user.gatekeeperEnabled });
}

export async function PATCH(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;

	let enabled: unknown;
	try {
		({ enabled } = (await request.json()) as { enabled?: unknown });
	} catch {
		return NextResponse.json({ error: "Invalid request" }, { status: 400 });
	}
	if (typeof enabled !== "boolean") {
		return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
	}

	const db = getDb(env);
	await db.update(users).set({ gatekeeperEnabled: enabled }).where(eq(users.id, auth.user.id));
	if (enabled) {
		// Senders you already know are accepted from the start: only mail from
		// new senders is held for review.
		await db.update(contacts).set({ approved: true }).where(eq(contacts.userId, auth.user.id));
	}
	return NextResponse.json({ enabled });
}
