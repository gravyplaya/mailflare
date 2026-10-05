import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { linkedCalendars } from "@/db/schema";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { isComposioConfigured } from "@/lib/composio/client";
import { newId } from "@/lib/ids";

type ComposioConnectedAccount = {
	id?: string;
	status?: string;
};

type GoogleCalendarInfo = {
	id?: string;
	summary?: string;
	timeZone?: string;
};

async function composioRequest<T>(
	env: CloudflareEnv,
	path: string,
	init?: { method?: string; body?: unknown },
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
	const apiKey = env.COMPOSIO_API_KEY;
	if (!apiKey) return { ok: false, status: 400, error: "Composio is not configured on this instance" };
	const baseUrl = (env.COMPOSIO_BASE_URL?.trim() || "https://backend.composio.dev").replace(/\/+$/, "");
	try {
		const response = await fetch(`${baseUrl}${path}`, {
			method: init?.method ?? "GET",
			headers: { "x-api-key": apiKey, ...(init?.body ? { "content-type": "application/json" } : {}) },
			body: init?.body ? JSON.stringify(init.body) : undefined,
		});
		const payload = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
		if (!response.ok) {
			return { ok: false, status: response.status, error: payload?.error?.message ?? `Composio request failed (${response.status})` };
		}
		return { ok: true, data: (payload ?? {}) as T };
	} catch {
		return { ok: false, status: 502, error: "Unable to reach Composio" };
	}
}

/** Finds (or creates) the managed Google Calendar auth config for this project. */
async function findGoogleCalendarAuthConfig(env: CloudflareEnv): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
	const listed = await findExistingGoogleCalendarAuthConfig(env);
	if (listed.ok && listed.data) return { ok: true, id: listed.data };
	const created = await composioRequest<{ auth_config?: { id?: string } }>(env, "/api/v3/auth_configs", {
		method: "POST",
		body: { toolkit: { slug: "googlecalendar" }, authScheme: "OAUTH2", useComposioManagedAuth: true, name: "Mailflare Calendar" },
	});
	if (!created.ok) return created;
	if (!created.data.auth_config?.id) return { ok: false, status: 502, error: "Composio did not return an auth config" };
	return { ok: true, id: created.data.auth_config.id };
}

async function findExistingGoogleCalendarAuthConfig(env: CloudflareEnv): Promise<{ ok: true; data: string | null } | { ok: false; status: number; error: string }> {
	const apiKey = env.COMPOSIO_API_KEY;
	if (!apiKey) return { ok: false, status: 400, error: "Composio is not configured" };
	const baseUrl = (env.COMPOSIO_BASE_URL?.trim() || "https://backend.composio.dev").replace(/\/+$/, "");
	try {
		const response = await fetch(`${baseUrl}/api/v3/auth_configs?toolkit_slugs=googlecalendar&limit=1`, { headers: { "x-api-key": apiKey } });
		const payload = (await response.json().catch(() => null)) as { items?: { id?: string }[] } | null;
		const id = payload?.items?.[0]?.id;
		return { ok: true, data: id ?? null };
	} catch {
		return { ok: false, status: 502, error: "Unable to reach Composio" };
	}
}

/** Lists ACTIVE googlecalendar connections with their primary calendar identity. */
export async function listGoogleCalendarConnections(
	env: CloudflareEnv,
): Promise<{ ok: true; data: { connectedAccountId: string; label: string | null }[] } | { ok: false; status: number; error: string }> {
	const listed = await composioRequest<{ items?: ComposioConnectedAccount[] }>(env, "/api/v3/connected_accounts?toolkit_slugs=googlecalendar&limit=20");
	if (!listed.ok) return listed;
	const items = (listed.data.items ?? []).filter((item): item is ComposioConnectedAccount & { id: string } => Boolean(item.id));
	const active = items.filter((item) => !item.status || item.status === "ACTIVE");
	const connections = await Promise.all(active.map(async (item) => {
		const calendar = await composioRequest<GoogleCalendarInfo>(env, `/api/v3.1/tools/execute/proxy`, {
			method: "POST",
			body: {
				connected_account_id: item.id,
				endpoint: "https://www.googleapis.com/calendar/v3/calendars/primary",
				method: "GET",
				parameters: [],
			},
		});
		const info = calendar.ok ? calendar.data : null;
		return {
			connectedAccountId: item.id,
			label: info?.id ?? info?.summary ?? null,
		};
	}));
	return { ok: true, data: connections.map(({ connectedAccountId, label }) => ({ connectedAccountId, label })) };
}

/** Registers a linked calendar row for a Composio googlecalendar connection, if not already linked. */
export async function registerLinkedCalendar(env: CloudflareEnv, user: { id: string }, connectedAccountId: string): Promise<{ registered: boolean; label: string | null; id: string }> {
	const db = getDb(env);
	const connections = await listGoogleCalendarConnections(env);
	if (!connections.ok) throw new Error(connections.error);
	const match = connections.data.find((connection) => connection.connectedAccountId === connectedAccountId);
	if (!match) throw new Error("This Composio connection is not an active Google Calendar");
	const [existing] = await db.select({ id: linkedCalendars.id }).from(linkedCalendars).where(eq(linkedCalendars.connectedAccountId, connectedAccountId)).limit(1);
	if (existing) return { registered: false, label: match.label, id: existing.id };
	const id = newId("lcal");
	await db.insert(linkedCalendars).values({
		id,
		userId: user.id,
		connectedAccountId,
		calendarId: "primary",
		calendarSummary: match.label,
	});
	return { registered: true, label: match.label, id };
}

export async function createGoogleCalendarConnectLink(env: CloudflareEnv): Promise<{ ok: true; redirectUrl: string; connectedAccountId: string } | { ok: false; status: number; error: string }> {
	const authConfig = await findGoogleCalendarAuthConfig(env);
	if (!authConfig.ok) return authConfig;
	const linked = await composioRequest<{ redirect_url?: string; connected_account_id?: string }>(env, "/api/v3/connected_accounts/link", {
		method: "POST",
		body: { auth_config_id: authConfig.id, user_id: "mailflare-admin" },
	});
	if (!linked.ok) return linked;
	if (!linked.data.redirect_url) return { ok: false, status: 502, error: "Composio did not return a connect link" };
	return { ok: true, redirectUrl: linked.data.redirect_url, connectedAccountId: linked.data.connected_account_id ?? "" };
}

export async function disconnectLinkedCalendar(env: CloudflareEnv, user: { id: string }, id: string): Promise<boolean> {
	const db = getDb(env);
	const deleted = await db
		.delete(linkedCalendars)
		.where(and(eq(linkedCalendars.id, id), eq(linkedCalendars.userId, user.id)))
		.returning({ id: linkedCalendars.id });
	return deleted.length > 0;
}
