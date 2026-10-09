import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "mailflare-sender-grouping";
const CHANGE_EVENT = "mailflare:sender-grouping-changed";

function readStored(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) === "on";
	} catch {
		return false;
	}
}

/**
 * Whether the inbox bundles every message from one sender into a single row.
 * Off by default and remembered per browser; every open list follows a change
 * immediately.
 */
export function useSenderGrouping(): [boolean, (next: boolean) => void] {
	const [enabled, setEnabled] = useState(false);

	useEffect(() => {
		const sync = () => setEnabled(readStored());
		sync();
		window.addEventListener(CHANGE_EVENT, sync);
		window.addEventListener("storage", sync);
		return () => {
			window.removeEventListener(CHANGE_EVENT, sync);
			window.removeEventListener("storage", sync);
		};
	}, []);

	const update = useCallback((next: boolean) => {
		try {
			localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
		} catch {
			// Private mode or blocked storage: the toggle still applies for this page.
		}
		setEnabled(next);
		window.dispatchEvent(new Event(CHANGE_EVENT));
	}, []);

	return [enabled, update];
}
