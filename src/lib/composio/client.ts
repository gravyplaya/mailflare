/**
 * Composio backend client.
 *
 * Linked email accounts (e.g. Gmail) are connected in the user's Composio
 * project; Mailflare never sees the upstream OAuth token. Requests go through
 * Composio's proxy execute endpoint, which injects the connected account's
 * credentials server-side.
 *
 * Docs: https://docs.composio.dev/reference/api-reference/tools
 */

const DEFAULT_COMPOSIO_BASE_URL = "https://backend.composio.dev";
const GMAIL_API_BASE_URL = "https://gmail.googleapis.com";
/** Hard cap that also stays under Workers per-request subrequest limits. */
export const COMPOSIO_IMPORT_LIMIT_MAX = 50;

export type ComposioGmailProfile = {
	emailAddress: string;
	/** Current history cursor for the mailbox; used as the incremental sync baseline. */
	historyId?: string;
};

export type ComposioGmailLabel = {
	id: string;
	name: string;
	type: "system" | "user";
};

export type ComposioGmailMessageRef = {
	id: string;
	threadId?: string;
};

export type ComposioGmailRawMessage = {
	id: string;
	threadId?: string;
	raw: string;
};

export class ComposioError extends Error {
	status?: number;

	constructor(message: string, status?: number) {
		super(message);
		this.name = "ComposioError";
		this.status = status;
	}
}

export function isComposioConfigured(env: CloudflareEnv): boolean {
	return Boolean(env.COMPOSIO_API_KEY);
}

type ProxyPayload<T> = {
	data?: T;
	binary_data?: { url: string };
	status?: number;
	error?: { message?: string };
};
export async function composioProxy<T>(
	env: CloudflareEnv,
	input: {
		connectedAccountId: string;
		method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
		endpoint: string;
		query?: Record<string, string | number | undefined>;
		body?: unknown;
	},
): Promise<T> {
	const apiKey = env.COMPOSIO_API_KEY;
	if (!apiKey) throw new ComposioError("Composio is not configured on this instance");
	const baseUrl = (env.COMPOSIO_BASE_URL?.trim() || DEFAULT_COMPOSIO_BASE_URL).replace(/\/+$/, "");
	const parameters = Object.entries(input.query ?? {})
		.filter(([, value]) => value !== undefined && value !== "")
		.map(([name, value]) => ({ name, value: String(value), type: "query" as const }));

	let response: Response;
	try {
		response = await fetch(`${baseUrl}/api/v3.1/tools/execute/proxy`, {
			method: "POST",
			headers: { "x-api-key": apiKey, "content-type": "application/json" },
			body: JSON.stringify({
				connected_account_id: input.connectedAccountId,
				endpoint: input.endpoint,
				method: input.method,
				parameters,
				body: input.body ?? null,
			}),
		});
	} catch (error) {
		throw new ComposioError(error instanceof Error ? `Composio request failed: ${error.message}` : "Composio request failed");
	}

	let payload: ProxyPayload<T>;
	try {
		payload = (await response.json()) as ProxyPayload<T>;
	} catch {
		throw new ComposioError(`Composio returned an invalid response (${response.status})`, response.status);
	}
	if (!response.ok) {
		throw new ComposioError(payload.error?.message ?? `Composio request failed (${response.status})`, response.status);
	}
	if (payload.status && payload.status >= 400) {
		throw new ComposioError(`Gmail request failed (${payload.status})`, payload.status);
	}
	if (payload.data === undefined || payload.data === null) {
		throw new ComposioError("Composio returned an empty response");
	}
	return payload.data;
}

export async function fetchGmailProfile(env: CloudflareEnv, connectedAccountId: string): Promise<ComposioGmailProfile> {
	return composioProxy<ComposioGmailProfile>(env, {
		connectedAccountId,
		method: "GET",
		endpoint: `${GMAIL_API_BASE_URL}/gmail/v1/users/me/profile`,
	});
}

export async function fetchGmailMessageIds(
	env: CloudflareEnv,
	input: { connectedAccountId: string; query?: string; maxResults?: number },
): Promise<string[]> {
	const data = await composioProxy<{ messages?: ComposioGmailMessageRef[] }>(env, {
		connectedAccountId: input.connectedAccountId,
		method: "GET",
		endpoint: `${GMAIL_API_BASE_URL}/gmail/v1/users/me/messages`,
		query: { q: input.query, maxResults: input.maxResults },
	});
	return (data.messages ?? []).map((message) => message.id).filter(Boolean);
}

export async function fetchGmailRawMessage(
	env: CloudflareEnv,
	connectedAccountId: string,
	messageId: string,
): Promise<ComposioGmailRawMessage> {
	const data = await composioProxy<ComposioGmailRawMessage>(env, {
		connectedAccountId,
		method: "GET",
		endpoint: `${GMAIL_API_BASE_URL}/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
		query: { format: "raw" },
	});
	if (!data.raw) throw new ComposioError(`Gmail message ${messageId} returned no raw content`);
	return data;
}

export async function fetchGmailLabels(
	env: CloudflareEnv,
	connectedAccountId: string,
): Promise<ComposioGmailLabel[]> {
	const data = await composioProxy<{ labels?: ComposioGmailLabel[] }>(env, {
		connectedAccountId,
		method: "GET",
		endpoint: `${GMAIL_API_BASE_URL}/gmail/v1/users/me/labels`,
	});
	return (data.labels ?? []).filter((label) => label.id && label.name);
}

/** Decodes Gmail's base64url payload into raw MIME bytes. */
export function decodeGmailBase64Url(value: string): ArrayBuffer {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes.buffer;
}
