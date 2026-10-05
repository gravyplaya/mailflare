import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { linkedAccounts, mailboxes } from "@/db/schema";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { fetchGmailProfile, isComposioConfigured } from "@/lib/composio/client";
import { newId } from "@/lib/ids";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import { parseImportDestination } from "@/lib/import/destination";
import { readJsonBody } from "@/lib/http/request";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	const db = getDb(env);
	const rows = await db
		.select({
			id: linkedAccounts.id,
			mailboxId: linkedAccounts.mailboxId,
			mailboxName: mailboxes.displayName,
			mailboxLocalPart: mailboxes.localPart,
			provider: linkedAccounts.provider,
			connectedAccountId: linkedAccounts.connectedAccountId,
			emailAddress: linkedAccounts.emailAddress,
			destination: linkedAccounts.destination,
			enabled: linkedAccounts.enabled,
			lastSyncedAt: linkedAccounts.lastSyncedAt,
			lastError: linkedAccounts.lastError,
			createdAt: linkedAccounts.createdAt,
		})
		.from(linkedAccounts)
		.innerJoin(mailboxes, eq(mailboxes.id, linkedAccounts.mailboxId))
		.where(eq(linkedAccounts.userId, user.id))
		.orderBy(desc(linkedAccounts.createdAt));
	return NextResponse.json({ accounts: rows, configured: isComposioConfigured(env) });
}

export async function POST(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	let body: { mailboxId?: string; connectedAccountId?: string; destination?: string };
	try {
		body = await readJsonBody(request, 8 * 1024);
	} catch {
		return NextResponse.json({ error: "Invalid linked account request" }, { status: 400 });
	}

	if (!isComposioConfigured(env)) {
		return NextResponse.json({ error: "Composio is not configured on this instance" }, { status: 400 });
	}
	const connectedAccountId = body.connectedAccountId?.trim() ?? "";
	if (!connectedAccountId) {
		return NextResponse.json({ error: "Connected account ID is required" }, { status: 400 });
	}

	const db = getDb(env);
	const access = await getMailboxAccessLevel(db, user, body.mailboxId ?? "");
	if (!access?.canManage) {
		return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	}
	let destination;
	try {
		destination = parseImportDestination(body.destination);
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Destination is invalid" }, { status: 400 });
	}

	let profile;
	try {
		profile = await fetchGmailProfile(env, connectedAccountId);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Unable to reach the Composio connected account" },
			{ status: 502 },
		);
	}

	const [existing] = await db
		.select({ id: linkedAccounts.id, userId: linkedAccounts.userId })
		.from(linkedAccounts)
		.where(and(eq(linkedAccounts.provider, "gmail"), eq(linkedAccounts.connectedAccountId, connectedAccountId)))
		.limit(1);

	const values = {
		mailboxId: access.mailbox.id,
		emailAddress: profile.emailAddress,
		destination: destination.type === "folder" ? `folder:${destination.folderId}` : `system:${destination.section}`,
		lastError: null,
	};

	if (existing) {
		if (existing.userId !== user.id) {
			return NextResponse.json({ error: "Linked account already exists" }, { status: 409 });
		}
		await db.update(linkedAccounts).set(values).where(eq(linkedAccounts.id, existing.id));
		return NextResponse.json({ id: existing.id, emailAddress: profile.emailAddress });
	}

	const id = newId("link");
	await db.insert(linkedAccounts).values({ id, userId: user.id, ...values, connectedAccountId });
	return NextResponse.json({ id, emailAddress: profile.emailAddress });
}

export async function DELETE(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	const id = new URL(request.url).searchParams.get("id") ?? "";
	if (!id) {
		return NextResponse.json({ error: "Linked account id is required" }, { status: 400 });
	}
	const db = getDb(env);
	const deleted = await db
		.delete(linkedAccounts)
		.where(and(eq(linkedAccounts.id, id), eq(linkedAccounts.userId, user.id)))
		.returning({ id: linkedAccounts.id });
	if (!deleted.length) {
		return NextResponse.json({ error: "Linked account not found" }, { status: 404 });
	}
	return NextResponse.json({ ok: true });
}
