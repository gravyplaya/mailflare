import { parseImportDestination } from "@/lib/import/destination";
import { COMPOSIO_IMPORT_LIMIT_MAX } from "@/lib/composio/client";
import type { ImportDestination } from "@/lib/import/destination-types";
import type { ComposioImportRequest } from "./types";

export function parseComposioImportRequest(input: ComposioImportRequest): {
	mailboxId: string;
	connectedAccountId: string;
	query?: string;
	limit: number;
	destination: ImportDestination;
} {
	const mailboxId = input.mailboxId?.trim() ?? "";
	const connectedAccountId = input.connectedAccountId?.trim() ?? "";
	const query = input.query?.trim() || undefined;
	const limit = Math.min(Math.max(Number(input.limit ?? 25), 1), COMPOSIO_IMPORT_LIMIT_MAX);

	if (!mailboxId) throw new Error("Mailbox is required");
	if (!connectedAccountId) throw new Error("Composio connected account ID is required");

	return { mailboxId, connectedAccountId, query, limit, destination: parseImportDestination(input.destination) };
}
