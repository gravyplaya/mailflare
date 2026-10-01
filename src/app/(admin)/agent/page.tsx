"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_CLOUDFLARE_MODEL } from "@/lib/agent/provider-constants";
import { saveAssistantAvailability } from "@/lib/agent/availability-client";
import { parseAgentModelIds, toggleAgentModelId } from "@/lib/agent/model-ids";
import type { AgentModelOption, AgentProviderPreset } from "@/lib/agent/provider-types";
import type { AgentAdminForm } from "./types";
import { baseUrlForPreset, loadAgentAdminSettings, loadAgentModels, PROVIDER_PRESETS, saveAgentAdminSettings, saveAgentEnabled, updateAgentModelRate } from "./utils";

const initialForm: AgentAdminForm = { provider: "cloudflare", preset: "openai", baseUrl: "", apiKey: "", model: DEFAULT_CLOUDFLARE_MODEL, rates: {} };

export default function AdminAgentPage() {
	const [form, setForm] = useState<AgentAdminForm>(initialForm);
	const [assistantEnabled, setAssistantEnabled] = useState(true);
	const [enabledSaving, setEnabledSaving] = useState(false);
	const [enabledStatus, setEnabledStatus] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);
	const [cloudflareAvailable, setCloudflareAvailable] = useState(false);
	const [hasSavedKey, setHasSavedKey] = useState(false);
	const [savedEndpoint, setSavedEndpoint] = useState("");
	const [models, setModels] = useState<AgentModelOption[]>([]);
	const [modelSource, setModelSource] = useState<"catalog" | "suggested" | null>(null);
	const [modelsLoading, setModelsLoading] = useState(false);
	const [modelError, setModelError] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		let active = true;
		void loadAgentAdminSettings().then((data) => {
			if (!active) return;
			setForm({ provider: data.config.provider, preset: data.config.preset, baseUrl: data.config.baseUrl, apiKey: "", model: data.config.models.join(", "), rates: data.config.rates });
			setAssistantEnabled(data.assistantEnabled);
			setCloudflareAvailable(data.cloudflareAvailable);
			setHasSavedKey(data.config.hasApiKey);
			setSavedEndpoint(`${data.config.preset}|${data.config.baseUrl}`);
			setLoaded(true);
		}).catch((error) => { if (active) setStatus(error instanceof Error ? error.message : "Could not load agent settings"); });
		return () => { active = false; };
	}, []);

	const canUseSavedKey = hasSavedKey && savedEndpoint === `${form.preset}|${form.baseUrl}`;
	const selectedModelIds = parseAgentModelIds(form.model);
	useEffect(() => {
		if (!loaded) return;
		setModels([]);
		setModelSource(null);
		setModelError(null);
		if (form.provider === "compatible" && (!form.baseUrl || (!form.apiKey.trim() && !canUseSavedKey))) {
			setModelError(form.preset === "custom" && !form.baseUrl ? "Enter an HTTPS base URL to load models." : "Enter an API key to load models.");
			return;
		}
		const controller = new AbortController();
		const timer = window.setTimeout(() => {
			setModelsLoading(true);
			void loadAgentModels(form, controller.signal).then((data) => {
				setModels(data.models);
				setModelSource(data.source);
			}).catch((error) => {
				if (!controller.signal.aborted) setModelError(error instanceof Error ? error.message : "Could not load models");
			}).finally(() => { if (!controller.signal.aborted) setModelsLoading(false); });
		}, form.provider === "cloudflare" ? 0 : 500);
		return () => { window.clearTimeout(timer); controller.abort(); };
	}, [loaded, form.provider, form.preset, form.baseUrl, form.apiKey, canUseSavedKey]);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSaving(true);
		setStatus(null);
		try {
			const data = await saveAgentAdminSettings(form);
			setForm((current) => ({ ...current, apiKey: "", model: data.config.models.join(", "), rates: data.config.rates }));
			setHasSavedKey(data.config.hasApiKey);
			setSavedEndpoint(`${data.config.preset}|${data.config.baseUrl}`);
			setStatus("Agent provider saved. Assistant settings can now choose from these models.");
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Could not save agent settings");
		} finally { setSaving(false); }
	}

	return <div className="space-y-6">
		<div className="flex items-start justify-between gap-4"><div><h1 className="text-3xl font-medium text-neutral-900">Agent</h1><p className="mt-2 text-sm text-neutral-500">Choose the AI provider and models used by the email assistant for chat and drafts.</p></div><Link href="/ai-usage" className="shrink-0 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50">View Usage</Link></div>
		<Card className="rounded-3xl border-0 bg-white p-6">
			<CardContent className="flex items-center justify-between gap-4 p-0">
				<div><p className="font-medium text-neutral-900">Enable assistant</p><p className="mt-1 text-sm text-neutral-500">Show assistant chat and allow automatic drafts for everyone.</p></div>
				<Switch checked={assistantEnabled} disabled={!loaded || enabledSaving} onCheckedChange={(checked) => {
					setEnabledSaving(true);
					setEnabledStatus(null);
					void saveAgentEnabled(checked).then((data) => { setAssistantEnabled(data.assistantEnabled); saveAssistantAvailability(data.assistantEnabled); }).catch((error) => setEnabledStatus(error instanceof Error ? error.message : "Could not update assistant availability")).finally(() => setEnabledSaving(false));
				}} aria-label="Enable assistant" />
			</CardContent>
			{enabledStatus && <p role="status" className="mt-3 text-sm text-red-700">{enabledStatus}</p>}
		</Card>
		<Card className="rounded-3xl border-0 bg-white p-6">
			<CardHeader className="py-0"><CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" />AI provider</CardTitle><CardDescription>Email content is sent to the selected provider when someone uses the assistant. Sending a draft still requires human approval.</CardDescription></CardHeader>
			<CardContent className="pt-6"><form onSubmit={submit} className="space-y-5">
				<div className="space-y-2"><Label htmlFor="agent-provider">Provider</Label><select id="agent-provider" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.provider} disabled={!loaded} onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value as AgentAdminForm["provider"], baseUrl: event.target.value === "compatible" ? baseUrlForPreset(current.preset, current.baseUrl) : "", model: event.target.value === "cloudflare" ? DEFAULT_CLOUDFLARE_MODEL : "" }))}><option value="cloudflare">Cloudflare Workers AI</option><option value="compatible">OpenAI-compatible provider</option></select>{form.provider === "cloudflare" && !cloudflareAvailable && <p className="text-xs text-amber-700">Cloudflare Workers AI requires an AI binding on this installation.</p>}</div>
				{form.provider === "compatible" && <>
					<div className="space-y-2"><Label htmlFor="agent-preset">Provider template</Label><select id="agent-preset" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.preset} onChange={(event) => { const preset = event.target.value as AgentProviderPreset; setForm((current) => ({ ...current, preset, baseUrl: baseUrlForPreset(preset), apiKey: "", model: "" })); }}>{PROVIDER_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
					<div className="space-y-2"><Label htmlFor="agent-url">API base URL</Label><Input id="agent-url" type="url" value={form.baseUrl} readOnly={form.preset !== "custom"} placeholder="https://provider.example/v1" onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value, model: "" }))} required /></div>
					<div className="space-y-2"><Label htmlFor="agent-key">API key</Label><Input id="agent-key" type="password" value={form.apiKey} autoComplete="new-password" placeholder={canUseSavedKey ? "Saved key (leave blank to keep)" : "Enter API key"} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} /><p className="text-xs text-neutral-500">{canUseSavedKey ? "An API key is saved on the server. Enter a new one to replace it." : "The API key is stored on the server and is never shown again."}</p></div>
				</>}
				<div className="space-y-2"><p className="text-sm font-medium">Models</p><div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-input p-3">{modelsLoading && <p className="text-sm text-neutral-500">Loading models…</p>}{!modelsLoading && !models.length && <p className="text-sm text-neutral-500">Models unavailable</p>}{models.map((item) => <label key={item.id} className="flex items-start gap-2 text-sm"><Checkbox checked={selectedModelIds.includes(item.id)} onChange={(event) => setForm((current) => ({ ...current, model: toggleAgentModelId(current.model, item.id, event.target.checked) }))} /><span>{item.name === item.id ? item.id : `${item.name} · ${item.id}`}</span></label>)}</div>{modelSource === "suggested" && <p className="text-xs text-neutral-500">Showing suggested Cloudflare models because a full catalog is unavailable.</p>}{modelError && <p className="text-xs text-amber-700">{modelError}</p>}<Label htmlFor="agent-model-id" className="block pt-2 text-xs text-neutral-500">Or enter model IDs (comma-separated)</Label><Input id="agent-model-id" value={form.model} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} placeholder={form.provider === "cloudflare" ? DEFAULT_CLOUDFLARE_MODEL : "provider/model-id, provider/another-model"} required /><p className="text-xs text-neutral-500">Choose models that support tool calling so the assistant can read mail and create drafts. The first model is the default.</p></div>
				<div className="space-y-3"><p className="text-sm font-medium">Estimated cost rates</p><p className="text-xs text-neutral-500">Optional USD per 1 million tokens. Usage without both rates shows spending as unavailable.</p>{selectedModelIds.map((model) => <div key={model} className="grid gap-2 rounded-xl border border-neutral-200 p-3 sm:grid-cols-[minmax(0,1fr)_6rem_6rem]"><span className="min-w-0 break-all text-sm">{model}</span><label className="text-xs text-neutral-500">Input <Input type="number" min="0" step="any" value={form.rates[model]?.input ?? ""} onChange={(event) => setForm((current) => updateAgentModelRate(current, model, "input", event.target.value))} placeholder="USD / 1M" /></label><label className="text-xs text-neutral-500">Output <Input type="number" min="0" step="any" value={form.rates[model]?.output ?? ""} onChange={(event) => setForm((current) => updateAgentModelRate(current, model, "output", event.target.value))} placeholder="USD / 1M" /></label></div>)}</div>
				{status && <p role="status" className="text-sm text-neutral-700">{status}</p>}
				<Button type="submit" disabled={!loaded || saving || !selectedModelIds.length || (form.provider === "cloudflare" && !cloudflareAvailable) || (form.provider === "compatible" && (!form.baseUrl || (!form.apiKey.trim() && !canUseSavedKey))) }>{saving ? "Saving…" : "Save agent settings"}</Button>
			</form></CardContent>
		</Card>
	</div>;
}
