import type { AgentModelOption, AgentProviderPreset } from "./provider-types";
import { getAgentProviderConfig, resolveAgentBaseUrl } from "./provider";

export const CLOUDFLARE_TOOL_MODELS: AgentModelOption[] = [
	{ id: "@cf/moonshotai/kimi-k2.5", name: "Kimi K2.5" },
	{ id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B" },
	{ id: "@cf/qwen/qwen3-30b-a3b-fp8", name: "Qwen3 30B" },
];

export async function listCloudflareAgentModels(env: CloudflareEnv): Promise<{ models: AgentModelOption[]; source: "catalog" | "suggested" }> {
	if (!env.CF_ACCOUNT_ID || !env.CF_TOKEN) return { models: CLOUDFLARE_TOOL_MODELS, source: "suggested" };
	try {
		const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}/ai/models/search?task=Text%20Generation`, { headers: { Authorization: `Bearer ${env.CF_TOKEN}` }, signal: AbortSignal.timeout(10_000), redirect: "error" });
		if (!response.ok) throw new Error("Catalog unavailable");
		const json = await response.json() as { result?: { name?: unknown; description?: unknown; task?: unknown }[] };
		const models = (json.result ?? []).filter((item) => typeof item.name === "string" && item.name.startsWith("@cf/") && (item.task === "Text Generation" || item.task === "text-generation" || !item.task)).map((item) => ({ id: item.name as string, name: item.name as string })).slice(0, 200);
		return models.length ? { models, source: "catalog" } : { models: CLOUDFLARE_TOOL_MODELS, source: "suggested" };
	} catch { return { models: CLOUDFLARE_TOOL_MODELS, source: "suggested" }; }
}

export async function listCompatibleAgentModels(env: CloudflareEnv, input: { preset: AgentProviderPreset; baseUrl: string; apiKey?: string }) {
	const baseUrl = resolveAgentBaseUrl(input.preset, input.baseUrl);
	const saved = await getAgentProviderConfig(env);
	const key = input.apiKey?.trim() || (saved.provider === "compatible" && saved.preset === input.preset && saved.baseUrl === baseUrl ? saved.apiKey : "");
	if (!key) throw new Error("Enter an API key to load models");
	const response = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000), redirect: "error" });
	if (!response.ok) throw new Error(`Model list request failed (${response.status})`);
	const json = await response.json() as { data?: { id?: unknown; name?: unknown }[] };
	const models = (json.data ?? []).filter((item) => typeof item.id === "string" && item.id.length <= 200).map((item) => ({ id: item.id as string, name: typeof item.name === "string" ? item.name : item.id as string })).slice(0, 2_000).sort((a, b) => a.name.localeCompare(b.name));
	if (!models.length) throw new Error("Provider returned no models");
	return { models, source: "catalog" as const };
}
