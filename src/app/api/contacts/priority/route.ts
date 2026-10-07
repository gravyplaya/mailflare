import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { contacts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { setContactPriority } from "@/lib/contacts/service";
import { normalizeEmailAddress } from "@/lib/email/address";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const email = normalizeEmailAddress(new URL(request.url).searchParams.get("email") ?? "");
	if (!email) return NextResponse.json({ priority: false });

	const db = getDb(env);
	const [existing] = await db
		.select({ priority: contacts.priority })
		.from(contacts)
		.where(and(eq(contacts.userId, user.id), eq(contacts.email, email)))
		.limit(1);
	return NextResponse.json({ priority: existing?.priority ?? false });
}

export async function POST(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	let payload: { address?: unknown; priority?: unknown };
	try {
		payload = (await request.json()) as { address?: unknown; priority?: unknown };
	} catch {
		return NextResponse.json({ error: "Invalid request" }, { status: 400 });
	}
	const address = typeof payload.address === "string" ? payload.address : null;
	if (!address || !normalizeEmailAddress(address)) {
		return NextResponse.json({ error: "Sender address is required" }, { status: 400 });
	}

	const priority = payload.priority !== false;
	try {
		await setContactPriority(env, { userId: user.id, address, priority });
	} catch {
		return NextResponse.json({ error: "Could not update priority sender" }, { status: 400 });
	}
	return NextResponse.json({ ok: true, priority });
}
