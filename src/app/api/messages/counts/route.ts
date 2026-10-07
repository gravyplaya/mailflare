import { and, count, eq, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { followUps, messages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { buildMessageCounts } from "./utils";
import { getMailboxAccessLevel, listAccessibleMailboxIds } from "@/lib/mailboxes/access";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const url = new URL(request.url);
	const mailboxId = url.searchParams.get("mailboxId");
	const db = getDb(env);
	const conditions: SQL[] = [];

	if (mailboxId) {
		const access = await getMailboxAccessLevel(db, user, mailboxId);
		if (!access?.canRead) {
			return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
		}
		conditions.push(eq(messages.mailboxId, mailboxId));
	} else {
		const accessibleMailboxIds = await listAccessibleMailboxIds(db, user);
		if (accessibleMailboxIds.length > 0) {
			conditions.push(inArray(messages.mailboxId, accessibleMailboxIds));
		} else {
			conditions.push(eq(messages.userId, user.id));
		}
	}

	const rows = await db
		.select({
			mailboxId: messages.mailboxId,
			folderId: messages.folderId,
			direction: messages.direction,
			status: messages.status,
			read: messages.read,
			starred: messages.starred,
			snoozedUntil: messages.snoozedUntil,
			done: messages.done,
			total: count(),
		})
		.from(messages)
		.where(and(...conditions))
		.groupBy(
			messages.mailboxId,
			messages.folderId,
			messages.direction,
			messages.status,
			messages.read,
			messages.starred,
			messages.snoozedUntil,
			messages.done,
		);

	const [followUpRow] = await db
		.select({ total: count() })
		.from(followUps)
		.where(and(eq(followUps.userId, user.id), eq(followUps.status, "triggered")));

	return NextResponse.json({ counts: buildMessageCounts(rows), followUps: followUpRow?.total ?? 0 });
}
