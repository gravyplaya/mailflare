"use client";

import { useState } from "react";
import { useShowFullRecipientAddresses } from "@/components/messages/use-show-full-recipient-addresses";
import { Switch } from "@/components/ui/switch";

export function RecipientAddressSettings() {
	const { enabled, error, isLoading, setEnabled } = useShowFullRecipientAddresses();
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	return (
		<div>
			<label className="flex items-start gap-3 rounded-xl bg-neutral-50 p-4">
				<span className="flex-1">
					<span className="block text-sm font-medium text-neutral-900">Show full recipient addresses</span>
					<span className="mt-1 block text-sm text-neutral-500">
						On To, Cc, and Bcc, show Name &lt;user@domain.tld&gt; when the message includes a name. Off shows only the email address. This follows your sign-in, on every mailbox.
					</span>
				</span>
				<Switch
					checked={enabled}
					disabled={isLoading || saving}
					onCheckedChange={(next) => {
						setSaving(true);
						setSaveError(null);
						void setEnabled(next)
							.catch((updateError) => setSaveError(updateError instanceof Error ? updateError.message : "Failed to update recipient address settings"))
							.finally(() => setSaving(false));
					}}
					aria-label="Show full recipient addresses"
				/>
			</label>
			{(saveError || error) && <p className="mt-2 px-4 text-sm text-red-600">{saveError || error}</p>}
		</div>
	);
}
