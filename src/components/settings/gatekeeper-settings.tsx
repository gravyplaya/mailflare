"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth/client";
import { Switch } from "@/components/ui/switch";

export function GatekeeperSettings() {
	const [enabled, setEnabled] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		void authFetch("/api/settings/gatekeeper")
			.then(async (response) => {
				const data = await response.json() as { enabled?: boolean; error?: string };
				if (!response.ok) throw new Error(data.error ?? "Failed to load Gatekeeper settings");
				setEnabled(data.enabled === true);
			})
			.catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Failed to load Gatekeeper settings"))
			.finally(() => setLoading(false));
	}, []);

	async function updateEnabled(nextEnabled: boolean) {
		const previous = enabled;
		setEnabled(nextEnabled);
		setLoading(true);
		setError(null);
		try {
			const response = await authFetch("/api/settings/gatekeeper", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: nextEnabled }),
			});
			const data = await response.json() as { enabled?: boolean; error?: string };
			if (!response.ok) throw new Error(data.error ?? "Failed to update Gatekeeper settings");
			setEnabled(data.enabled === true);
			window.dispatchEvent(new Event("mailflare:messages-changed"));
		} catch (nextError) {
			setEnabled(previous);
			setError(nextError instanceof Error ? nextError.message : "Failed to update Gatekeeper settings");
		} finally {
			setLoading(false);
		}
	}

	if (error) return <p className="text-sm text-red-600">{error}</p>;

	return (
		<div className="flex items-center justify-between gap-4">
			<div>
				<p className="text-sm text-neutral-700">
					Hold mail from new senders until you accept them. Senders you already know stay approved.
				</p>
			</div>
			<Switch checked={enabled} disabled={loading} onCheckedChange={(value) => void updateEnabled(value)} aria-label="Enable Gatekeeper" />
		</div>
	);
}
