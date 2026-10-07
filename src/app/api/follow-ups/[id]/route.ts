import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { followUps } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const db = getDb(env);
	const [existing] = await db
		.select({ id: followUps.id })
		.from(followUps)
		.where(and(eq(followUps.id, id), eq(followUps.userId, user.id)))
		.limit(1);
	if (!existing) return NextResponse.json({ error: "Follow-up not found" }, { status: 404 });

	await db.update(followUps).set({ status: "cancelled" }).where(eq(followUps.id, id));
	return NextResponse.json({ ok: true });
}
