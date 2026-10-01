"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui/select";
import {
	isThemePreference,
	readThemePreference,
	saveThemePreference,
	THEME_CHANGED_EVENT,
	type ThemePreference,
} from "@/components/theme-utils";

const OPTIONS: { value: ThemePreference; label: string }[] = [
	{ value: "system", label: "Match system" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
];

export function AppearanceSettings() {
	const [preference, setPreference] = useState<ThemePreference>("system");

	useEffect(() => {
		setPreference(readThemePreference());
		const sync = () => setPreference(readThemePreference());
		window.addEventListener(THEME_CHANGED_EVENT, sync);
		return () => window.removeEventListener(THEME_CHANGED_EVENT, sync);
	}, []);

	return (
		<label className="flex items-start gap-3 rounded-xl bg-neutral-50 p-4">
			<span className="flex-1">
				<span className="block text-sm font-medium text-neutral-900">Theme</span>
				<span className="mt-1 block text-sm text-neutral-500">
					Use a light or dark interface, or follow your system setting. Saved in this browser.
				</span>
			</span>
			<Select
				value={preference}
				aria-label="Theme"
				className="py-1.5 text-sm text-neutral-900"
				onChange={(event) => {
					const next = event.target.value;
					if (!isThemePreference(next)) return;
					setPreference(next);
					saveThemePreference(next);
				}}
			>
				{OPTIONS.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</Select>
		</label>
	);
}
