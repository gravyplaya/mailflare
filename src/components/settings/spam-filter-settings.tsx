"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth/client";
import { useLanguage } from "@/components/language-provider";
import { Switch } from "@/components/ui/switch";

export function SpamFilterSettings() {
	const { t } = useLanguage();
	const [enabled, setEnabled] = useState(true);
	const [aiEnabled, setAiEnabled] = useState(true);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		void authFetch("/api/settings/spam")
			.then(async (response) => {
				const data = await response.json() as { enabled?: boolean; aiEnabled?: boolean; error?: string };
				if (!response.ok) throw new Error(data.error ?? t("settings.spam.loadFailed"));
				setEnabled(data.enabled !== false);
				setAiEnabled(data.aiEnabled !== false);
			})
			.catch((nextError) => setError(nextError instanceof Error ? nextError.message : t("settings.spam.loadFailed")))
			.finally(() => setLoading(false));
	}, []);

	async function updateEnabled(nextEnabled: boolean) {
		const previous = { enabled, aiEnabled };
		setEnabled(nextEnabled);
		setLoading(true);
		setError(null);
		try {
			const response = await authFetch("/api/settings/spam", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: nextEnabled, aiEnabled: previous.aiEnabled }),
			});
			const data = await response.json() as { enabled?: boolean; aiEnabled?: boolean; error?: string };
			if (!response.ok) throw new Error(data.error ?? t("settings.spam.updateFailed"));
			setEnabled(data.enabled !== false);
			setAiEnabled(data.aiEnabled !== false);
		} catch (nextError) {
			setEnabled(previous.enabled);
			setAiEnabled(previous.aiEnabled);
			setError(nextError instanceof Error ? nextError.message : t("settings.spam.updateFailed"));
		} finally {
			setLoading(false);
		}
	}

	async function updateAiEnabled(nextAiEnabled: boolean) {
		const previous = { enabled, aiEnabled };
		setAiEnabled(nextAiEnabled);
		setLoading(true);
		setError(null);
		try {
			const response = await authFetch("/api/settings/spam", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: previous.enabled, aiEnabled: nextAiEnabled }),
			});
			const data = await response.json() as { enabled?: boolean; aiEnabled?: boolean; error?: string };
			if (!response.ok) throw new Error(data.error ?? t("settings.spam.updateFailed"));
			setEnabled(data.enabled !== false);
			setAiEnabled(data.aiEnabled !== false);
		} catch (nextError) {
			setEnabled(previous.enabled);
			setAiEnabled(previous.aiEnabled);
			setError(nextError instanceof Error ? nextError.message : t("settings.spam.updateFailed"));
		} finally {
			setLoading(false);
		}
	}

	return (
		<div>
			<label className="flex items-start gap-3 rounded-xl bg-neutral-50 p-4">
				<span className="flex-1">
					<span className="block text-sm font-medium text-neutral-900">{t("settings.spam.title")}</span>
					<span className="mt-1 block text-sm text-neutral-500">{t("settings.spam.description")}</span>
				</span>
				<Switch checked={enabled} disabled={loading} onCheckedChange={(value) => void updateEnabled(value)} aria-label={t("settings.spam.enable")} />
			</label>
			<label className="mt-2 flex items-start gap-3 rounded-xl bg-neutral-50 p-4">
				<span className="flex-1">
					<span className="block text-sm font-medium text-neutral-900">AI Spam Filter</span>
					<span className="mt-1 block text-sm text-neutral-500">Classify incoming messages with an AI model. Senders you know are never auto-filed to spam by the AI alone.</span>
				</span>
				<Switch checked={aiEnabled} disabled={loading || !enabled} onCheckedChange={(value) => void updateAiEnabled(value)} aria-label="Enable AI spam filter" />
			</label>
			{error && <p className="mt-2 px-4 text-sm text-red-600">{error}</p>}
		</div>
	);
}
