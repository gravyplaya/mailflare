import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { fetchGmailProfile, isComposioConfigured } from "@/lib/composio/client";

type ConnectedAccountItem = {
	id?: string;
	status?: string;
};

/** Lists the Gmail accounts connected in the Composio project, ready to pick in the import UI. */
export async function GET(request: Request) {
	const env = getEnv();
	await requireUser(env, request);
	if (!isComposioConfigured(env)) {
		return NextResponse.json({ error: "Composio is not configured on this instance" }, { status: 400 });
	}

	const apiKey = env.COMPOSIO_API_KEY;
	if (!apiKey) {
		return NextResponse.json({ error: "Composio is not configured on this instance" }, { status: 400 });
	}
	const baseUrl = (env.COMPOSIO_BASE_URL?.trim() || "https://backend.composio.dev").replace(/\/+$/, "");
	let response: Response;
	try {
		response = await fetch(`${baseUrl}/api/v3/connected_accounts?toolkit_slugs=gmail&limit=20`, {
			headers: { "x-api-key": apiKey },
		});
	} catch {
		return NextResponse.json({ error: "Unable to reach Composio" }, { status: 502 });
	}
	if (!response.ok) {
		return NextResponse.json({ error: "Composio rejected the request" }, { status: 502 });
	}
	const payload = (await response.json().catch(() => null)) as { items?: ConnectedAccountItem[] } | null;
	const items = (payload?.items ?? [])
		.filter((item): item is ConnectedAccountItem & { id: string } => Boolean(item.id))
		.filter((item) => !item.status || item.status === "ACTIVE");

	// Resolve each account's Gmail address for a friendly picker label.
	const accounts = await Promise.all(items.map(async (item) => {
		try {
			const profile = await fetchGmailProfile(env, item.id);
			return { connectedAccountId: item.id, email: profile.emailAddress };
		} catch {
			return { connectedAccountId: item.id, email: null };
		}
	}));

	return NextResponse.json({ accounts });
}
