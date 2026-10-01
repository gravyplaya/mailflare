"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadGeneralSettings, saveGeneralSettings } from "./utils";

export default function GeneralSettingsPage() {
	const [maxMb, setMaxMb] = useState(25);
	const [loaded, setLoaded] = useState(false);
	const [saving, setSaving] = useState(false);
	const [status, setStatus] = useState("");

	useEffect(() => {
		let active = true;
		void loadGeneralSettings().then((settings) => {
			if (active) { setMaxMb(settings.outboundAttachmentMaxMb); setLoaded(true); }
		}).catch((error) => { if (active) setStatus(error instanceof Error ? error.message : "Could not load settings"); });
		return () => { active = false; };
	}, []);

	async function save(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSaving(true);
		setStatus("");
		try {
			const settings = await saveGeneralSettings(maxMb);
			setMaxMb(settings.outboundAttachmentMaxMb);
			setStatus("Attachment limit saved");
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Could not save settings");
		} finally { setSaving(false); }
	}

	return <div className="space-y-6">
		<div><h1 className="text-3xl font-medium text-neutral-900">General</h1><p className="mt-2 text-sm text-neutral-500">Set limits for outgoing mail.</p></div>
		<Card className="rounded-3xl border-0 bg-white p-6">
			<CardHeader className="py-0"><CardTitle>File attachments</CardTitle></CardHeader>
			<CardContent className="pt-6"><form onSubmit={save} className="space-y-4">
				<div className="space-y-2"><Label htmlFor="attachment-limit">Maximum attachments per email (MB)</Label><Input id="attachment-limit" type="number" min="1" max="25" step="1" value={maxMb} onChange={(event) => setMaxMb(Number(event.target.value))} disabled={!loaded || saving} className="max-w-40" required /><p className="text-sm text-neutral-500">Applies to each file and all files combined. Maximum: 25 MB; up to 10 files.</p></div>
				<div className="space-y-2 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-700"><p>Cloudflare Email Sending limits the complete email, including attachments and encoding, to 5 MiB for general recipients. The 25 MiB exception applies only to verified destination addresses.</p><p>Files over 3 MB, and smaller files that would make the email exceed Cloudflare’s 5 MiB limit, are stored in R2 and sent as download links. Links expire after 30 days. Anyone with a link can download the file until it expires. Set APP_URL to your public HTTPS address when sending through API or background workflows.</p></div>
				{status && <p role="status" className="text-sm text-neutral-700">{status}</p>}
				<Button type="submit" disabled={!loaded || saving || !Number.isInteger(maxMb) || maxMb < 1 || maxMb > 25}>{saving ? "Saving…" : "Save settings"}</Button>
			</form></CardContent>
		</Card>
	</div>;
}
