import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { listAccessibleMailboxes, getMailboxAccessLevel } from "@/lib/mailboxes/access";
import { setContactApproval } from "@/lib/contacts/service";
import { blockContact } from "@/lib/contacts/service";
import { normalizeEmailAddress } from "@/lib/email/address";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const url = new URL(request.url);
	const mailboxId = url.searchParams.get("mailboxId");
	const db = getDb(env);
	const conditions = [eq(messages.status, "pending")];
	if (mailboxId) {
		const access = await getMailboxAccessLevel(db, user, mailboxId);
		if (!access?.canRead) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
		conditions.push(eq(messages.mailboxId, mailboxId));
	} else {
		const accessibleMailboxIds = (await listAccessibleMailboxes(db, user)).map((mailbox) => mailbox.id);
		if (accessibleMailboxIds.length === 0) return NextResponse.json({ messages: [] });
		conditions.push(inArray(messages.mailboxId, accessibleMailboxIds));
	}

	const rows = await db
		.select({
			id: messages.id,
			mailboxId: messages.mailboxId,
			fromAddr: messages.fromAddr,
			subject: messages.subject,
			snippet: messages.snippet,
			createdAt: messages.createdAt,
		})
		.from(messages)
		.where(and(...conditions))
		.orderBy(desc(messages.createdAt))
		.limit(200);

	return NextResponse.json({ messages: rows });
}

export async function POST(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	let payload: { action?: unknown; address?: unknown };
	try {
		payload = (await request.json()) as { action?: unknown; address?: unknown };
	} catch {
		return NextResponse.json({ error: "Invalid request" }, { status: 400 });
	}
	if (payload.action !== "approve" && payload.action !== "block") {
		return NextResponse.json({ error: "Unknown action" }, { status: 400 });
	}
	const address = typeof payload.address === "string" ? normalizeEmailAddress(payload.address) : null;
	if (!address) return NextResponse.json({ error: "Sender address is required" }, { status: 400 });

	const db = getDb(env);
	const accessibleMailboxIds = (await listAccessibleMailboxes(db, user)).map((mailbox) => mailbox.id);
	if (accessibleMailboxIds.length === 0) {
		return NextResponse.json({ error: "No accessible mailboxes" }, { status: 404 });
	}

	const pending = await db
		.select({ id: messages.id, mailboxId: messages.mailboxId, fromAddr: messages.fromAddr })
		.from(messages)
		.where(and(
			eq(messages.status, "pending"),
			inArray(messages.mailboxId, accessibleMailboxIds),
		));
	const held = pending.filter((message) => normalizeEmailAddress(message.fromAddr) === address);

	// Both actions need manage access on the mailboxes holding the mail.
	const allowedMailboxIds = new Set<string>();
	for (const mailboxId of new Set(held.map((message) => message.mailboxId))) {
		if (!mailboxId) continue;
		const access = await getMailboxAccessLevel(db, user, mailboxId);
		if (access?.canManage) allowedMailboxIds.add(mailboxId);
	}
	const heldIds = held.filter((message) => message.mailboxId && allowedMailboxIds.has(message.mailboxId)).map((message) => message.id);
	if (heldIds.length === 0) {
		return NextResponse.json({ error: "No held messages from this sender" }, { status: 404 });
	}

	if (payload.action === "approve") {
		await setContactApproval(env, { userId: user.id, address, approved: true });
		await db
			.update(messages)
			.set({ status: "received", snoozedUntil: null })
			.where(inArray(messages.id, heldIds));
	} else {
		const firstMailboxId = held
			.map((message) => message.mailboxId)
			.find((id): id is string => !!id && allowedMailboxIds.has(id));
		if (!firstMailboxId) {
			return NextResponse.json({ error: "No accessible mailboxes" }, { status: 404 });
		}
		const mailbox = (await listAccessibleMailboxes(db, user)).find((item) => item.id === firstMailboxId);
		await blockContact(env, { userId: user.id, address, mailboxId: firstMailboxId, domainId: mailbox?.domainId ?? "" });
		await db
			.update(messages)
			.set({ status: "trash", snoozedUntil: null })
			.where(inArray(messages.id, heldIds));
	}

	return NextResponse.json({ ok: true, updated: heldIds.length });
}
