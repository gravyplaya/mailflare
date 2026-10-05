import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { folders } from "@/db/schema";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { decodeGmailBase64Url, fetchGmailMessageIds, fetchGmailRawMessage, isComposioConfigured } from "@/lib/composio/client";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { readJsonBody } from "@/lib/http/request";
import { getImportMessageUserId } from "@/lib/import/destination";
import { importMessagesToMailbox } from "@/lib/import/service";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import type { ComposioImportRequest } from "./types";
import { parseComposioImportRequest } from "./utils";

export async function POST(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	if (!isComposioConfigured(env)) {
		return NextResponse.json({ error: "Composio is not configured on this instance" }, { status: 400 });
	}
	let input: ReturnType<typeof parseComposioImportRequest>;
	try {
		const body = await readJsonBody<ComposioImportRequest>(request, 16 * 1024);
		input = parseComposioImportRequest(body);
	} catch (error) {
		const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
		return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid Composio import request" }, { status });
	}

	const access = await getMailboxAccessLevel(getDb(env), user, input.mailboxId);
	if (!access?.canManage) {
		return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	}
	if (input.destination.type === "folder") {
		const db = getDb(env);
		const [folder] = await db
			.select({ id: folders.id })
			.from(folders)
			.where(and(eq(folders.id, input.destination.folderId), eq(folders.mailboxId, access.mailbox.id)))
			.limit(1);
		if (!folder) {
			return NextResponse.json({ error: "Folder not found" }, { status: 404 });
		}
	}

	try {
		const messageIds = await fetchGmailMessageIds(env, {
			connectedAccountId: input.connectedAccountId,
			query: input.query,
			maxResults: input.limit,
		});
		const messages: { filename: string; raw: ArrayBuffer }[] = [];
		for (const messageId of messageIds) {
			const raw = await fetchGmailRawMessage(env, input.connectedAccountId, messageId);
			messages.push({ filename: `${messageId}.eml`, raw: decodeGmailBase64Url(raw.raw) });
		}
		const result = await importMessagesToMailbox(env, {
			userId: getImportMessageUserId(input.destination, user.id, access.mailbox.userId),
			mailboxId: access.mailbox.id,
			destination: input.destination,
			messages,
		});
		return NextResponse.json(result);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Composio import failed" },
			{ status: 502 },
		);
	}
}
