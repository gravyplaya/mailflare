import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { followUps, messages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const db = getDb(env);
	const rows = await db
		.select({
			id: followUps.id,
			messageId: followUps.messageId,
			mailboxId: followUps.mailboxId,
			dueAt: followUps.dueAt,
			triggeredAt: followUps.triggeredAt,
			createdAt: followUps.createdAt,
			subject: messages.subject,
			toAddr: messages.toAddr,
			threadId: messages.threadId,
		})
		.from(followUps)
		.innerJoin(messages, eq(followUps.messageId, messages.id))
		.where(and(eq(followUps.userId, user.id), eq(followUps.status, "triggered")))
		.orderBy(desc(followUps.triggeredAt))
		.limit(100);

	return NextResponse.json({ followUps: rows });
}
