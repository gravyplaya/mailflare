import { saveManagedAccount } from "../utils";
import type { PasswordSaveOptions } from "./types";

export async function saveAccountPassword({ event, account, password, setPassword, setSaving, setMessage }: PasswordSaveOptions) {
	event.preventDefault();
	if (!account) return;
	setSaving(true);
	setMessage(null);
	try {
		await saveManagedAccount({ ...account, newPassword: password });
		setPassword("");
		setMessage("Password reset. This account has been signed out everywhere.");
	} catch (error) {
		setMessage(error instanceof Error ? error.message : "Unable to reset password");
	} finally {
		setSaving(false);
	}
}
