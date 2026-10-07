import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { messages, mutedThreads } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import { newId } from "@/lib/ids";

async function loadMessage(db: ReturnType<typeof getDb>, messageId: string) {
	const [message] = await db
		.select({ id: messages.id, mailboxId: messages.mailboxId, threadId: messages.threadId, userId: messages.userId })
		.from(messages)
		.where(eq(messages.id, messageId))
		.limit(1);
	return message ?? null;
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ messageId: string }> },
) {
	const { messageId } = await params;
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const db = getDb(env);
	const message = await loadMessage(db, messageId);
	if (!message?.mailboxId || !message.threadId) {
		return NextResponse.json({ muted: false, autoArchive: false });
	}
	const access = await getMailboxAccessLevel(db, user, message.mailboxId);
	if (!access?.canRead) return NextResponse.json({ muted: false, autoArchive: false });

	const [muted] = await db
		.select({ autoArchive: mutedThreads.autoArchive })
		.from(mutedThreads)
		.where(and(eq(mutedThreads.mailboxId, message.mailboxId), eq(mutedThreads.threadId, message.threadId)))
		.limit(1);
	return NextResponse.json({ muted: !!muted, autoArchive: muted?.autoArchive ?? false });
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ messageId: string }> },
) {
	const { messageId } = await params;
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	let autoArchive = false;
	try {
		const payload = (await request.json()) as { autoArchive?: unknown };
		autoArchive = payload.autoArchive === true;
	} catch {
		autoArchive = false;
	}

	const db = getDb(env);
	const message = await loadMessage(db, messageId);
	if (!message?.mailboxId || !message.threadId) {
		return NextResponse.json({ error: "Only conversations can be muted" }, { status: 400 });
	}
	const access = await getMailboxAccessLevel(db, user, message.mailboxId);
	if (!access?.canManage) return NextResponse.json({ error: "Message not found" }, { status: 404 });

	await db
		.insert(mutedThreads)
		.values({
			id: newId("mut"),
			userId: message.userId,
			mailboxId: message.mailboxId,
			threadId: message.threadId,
			autoArchive,
		})
		.onConflictDoUpdate({
			target: [mutedThreads.mailboxId, mutedThreads.threadId],
			set: { autoArchive },
		});
	return NextResponse.json({ ok: true, muted: true, autoArchive });
}

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ messageId: string }> },
) {
	const { messageId } = await params;
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const db = getDb(env);
	const message = await loadMessage(db, messageId);
	if (!message?.mailboxId || !message.threadId) {
		return NextResponse.json({ error: "Message not found" }, { status: 404 });
	}
	const access = await getMailboxAccessLevel(db, user, message.mailboxId);
	if (!access?.canManage) return NextResponse.json({ error: "Message not found" }, { status: 404 });

	await db
		.delete(mutedThreads)
		.where(and(eq(mutedThreads.mailboxId, message.mailboxId), eq(mutedThreads.threadId, message.threadId)));
	return NextResponse.json({ ok: true, muted: false });
}
