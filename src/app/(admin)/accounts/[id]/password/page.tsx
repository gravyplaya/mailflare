"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ManagedAccount } from "../types";
import { fetchManagedAccount } from "../utils";
import { saveAccountPassword } from "./utils";

export default function AccountPasswordPage() {
	const { id } = useParams<{ id: string }>();
	const [account, setAccount] = useState<ManagedAccount | null>(null);
	const [password, setPassword] = useState("");
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	useEffect(() => {
		void fetchManagedAccount(id)
			.then(setAccount)
			.catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load account"));
	}, [id]);

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-3xl font-medium text-neutral-900">Password</h1>
				<p className="mt-2 text-sm text-neutral-500">Reset the password for {account?.name ?? "this account"}.</p>
			</div>
			<form
				onSubmit={(event) => void saveAccountPassword({ event, account, password, setPassword, setSaving, setMessage })}
				className="space-y-5 rounded-3xl bg-white p-6"
			>
				{account && !account.editable ? (
					<p className="text-sm text-neutral-500">Only the primary admin can reset an admin account password.</p>
				) : (
					<>
						<div className="space-y-2">
							<Label htmlFor="account-new-password">New password</Label>
							<Input
								id="account-new-password"
								type="password"
								autoComplete="new-password"
								minLength={8}
								maxLength={128}
								required
								value={password}
								disabled={!account || saving}
								onChange={(event) => setPassword(event.target.value)}
								placeholder="Enter at least 8 characters"
							/>
							<p className="text-xs leading-5 text-neutral-500">
								Setting a password signs this account out everywhere. Share it with the user through another channel.
							</p>
						</div>
						<Button type="submit" disabled={!account || saving || password.trim().length < 8}>
							{saving ? "Resetting..." : "Reset password"}
						</Button>
					</>
				)}
			</form>
			{message && <p role="status" className="text-sm text-neutral-500">{message}</p>}
		</div>
	);
}
