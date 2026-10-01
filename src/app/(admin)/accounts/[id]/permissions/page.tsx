"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { ProgressiveAvatarImage } from "@/components/progressive-avatar-image";
import { getAvatarColorStyle } from "@/lib/avatar-colors";
import { useCurrentUser, clearCurrentUserCache } from "@/hooks/use-current-user";
import type { ManagedAccount } from "../types";
import {
	fetchManagedAccount,
	fetchTransferCandidates,
	saveManagedAccount,
	transferPrimaryAdmin,
	type TransferCandidate,
} from "../utils";

export default function AccountPermissionsPage() {
	const { id } = useParams<{ id: string }>();
	const currentUser = useCurrentUser();
	const [account, setAccount] = useState<ManagedAccount | null>(null);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [candidates, setCandidates] = useState<TransferCandidate[]>([]);
	const [transferTargetId, setTransferTargetId] = useState("");
	const [transferOpen, setTransferOpen] = useState(false);
	const [transferring, setTransferring] = useState(false);

	useEffect(() => {
		void fetchManagedAccount(id)
			.then(setAccount)
			.catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load permissions"));
	}, [id]);

	const isPrimary = !!account?.canChangeRole;
	const transferTarget = useMemo(
		() => candidates.find((candidate) => candidate.id === transferTargetId) ?? null,
		[candidates, transferTargetId],
	);

	useEffect(() => {
		if (!isPrimary) return;
		void fetchTransferCandidates()
			.then((list) => setCandidates(list.filter((candidate) => candidate.id !== currentUser?.id && !candidate.disabled)))
			.catch(() => undefined);
	}, [isPrimary, currentUser?.id]);

	async function savePermissions() {
		if (!account) return;
		setSaving(true);
		setMessage(null);
		try {
			await saveManagedAccount(account);
			setMessage("Permissions updated");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Unable to update permissions");
		} finally {
			setSaving(false);
		}
	}

	async function confirmTransfer() {
		if (!transferTarget) return;
		setTransferring(true);
		setMessage(null);
		try {
			await transferPrimaryAdmin(transferTarget.id);
			clearCurrentUserCache();
			setTransferOpen(false);
			// A full reload drops the stale cached session so the navigation reflects the new role.
			window.location.assign(`/accounts/${transferTarget.id}/permissions`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Unable to transfer the primary admin role");
			setTransferring(false);
		}
	}

	const editable = !!account?.editable;

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-3xl font-medium text-neutral-900">Permissions</h1>
				<p className="mt-2 text-sm text-neutral-500">Control what this account can manage.</p>
			</div>
			{account?.isPrimaryAdmin && (
				<section className="rounded-3xl bg-amber-50 p-6">
					<p className="text-sm font-semibold text-amber-900">Primary admin</p>
					<p className="mt-1 text-sm text-amber-800">This account owns administration and cannot be demoted or disabled. Transfer the role to hand it over.</p>
				</section>
			)}
			<section className="space-y-3 rounded-3xl bg-white p-6">
				<label htmlFor="account-role" className="block text-sm font-semibold text-neutral-900">Role</label>
				<Select
					id="account-role"
					value={account?.role ?? "user"}
					disabled={!account || saving || !account.canChangeRole}
					containerClassName="w-full sm:w-64"
					className="h-10 text-sm"
					onChange={(event) => account && setAccount({ ...account, role: event.target.value === "admin" ? "admin" : "user" })}
				>
					<option value="user">User</option>
					<option value="admin">Admin</option>
				</Select>
				<p className="text-xs text-neutral-500">
					{account?.canChangeRole
						? "Admins can access administration pages and manage Team settings."
						: "Only the primary admin can change roles."}
				</p>
			</section>
			<div className="overflow-hidden rounded-3xl bg-white">
				<table className="w-full text-left">
					<thead className="border-b border-neutral-100 bg-neutral-50 text-xs font-semibold uppercase tracking-wide text-neutral-500">
						<tr>
							<th className="px-5 py-3">Permission</th>
							<th className="w-28 px-5 py-3 text-center">Allowed</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-neutral-100">
						<tr>
							<td className="px-5 py-4">
								<p className="text-sm font-semibold text-neutral-900">Manage mailboxes</p>
								<p className="mt-1 text-xs text-neutral-500">Allow this account to add and remove its own inboxes.</p>
							</td>
							<td className="px-5 py-4 text-center">
								<Checkbox
									aria-label="Allow mailbox management"
									checked={account?.canManageMailboxes ?? false}
									disabled={!account || !editable}
									onChange={(event) => account && setAccount({ ...account, canManageMailboxes: event.target.checked })}
								/>
							</td>
						</tr>
						<tr>
							<td className="px-5 py-4">
								<p className="text-sm font-semibold text-neutral-900">Manage domains</p>
								<p className="mt-1 text-xs text-neutral-500">Allow this admin to add and manage domains.</p>
							</td>
							<td className="px-5 py-4 text-center">
								<Checkbox
									aria-label="Allow domain management"
									checked={account?.canManageDomains ?? false}
									disabled={!account || !account.canChangeRole}
									onChange={(event) => account && setAccount({ ...account, canManageDomains: event.target.checked })}
								/>
							</td>
						</tr>
						<tr>
							<td className="px-5 py-4">
								<p className="text-sm font-semibold text-neutral-900">Manage users</p>
								<p className="mt-1 text-xs text-neutral-500">Allow this admin to add and manage user accounts.</p>
							</td>
							<td className="px-5 py-4 text-center">
								<Checkbox
									aria-label="Allow user management"
									checked={account?.canManageUsers ?? false}
									disabled={!account || !account.canChangeRole}
									onChange={(event) => account && setAccount({ ...account, canManageUsers: event.target.checked })}
								/>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
			{editable && (
				<Button onClick={() => void savePermissions()} disabled={saving}>
					{saving ? "Saving..." : "Save permissions"}
				</Button>
			)}
			{isPrimary && (
				<section className="space-y-4 rounded-3xl bg-white p-6">
					<div>
						<h2 className="text-sm font-semibold text-neutral-900">Transfer primary admin</h2>
						<p className="mt-1 text-xs text-neutral-500">Choose an account by email to take over administration. You will be asked to confirm.</p>
					</div>
					<div className="flex flex-col gap-3 sm:flex-row">
						<Select
							aria-label="Select the next primary admin"
							value={transferTargetId}
							containerClassName="w-full sm:max-w-sm"
							className="h-10 text-sm"
							onChange={(event) => setTransferTargetId(event.target.value)}
						>
							<option value="">Select an account</option>
							{candidates.map((candidate) => (
								<option key={candidate.id} value={candidate.id}>{candidate.email} — {candidate.name}</option>
							))}
						</Select>
						<Button variant="outline" disabled={!transferTarget} onClick={() => setTransferOpen(true)}>
							Transfer primary admin
						</Button>
					</div>
				</section>
			)}
			{message && <p className="text-sm text-neutral-500">{message}</p>}

			<Dialog open={transferOpen} onOpenChange={setTransferOpen}>
				<DialogContent className="w-[min(420px,calc(100vw-32px))]">
					<DialogHeader>
						<DialogTitle>Transfer primary admin?</DialogTitle>
						<DialogDescription>
							You will lose primary admin access and become a regular admin.
						</DialogDescription>
					</DialogHeader>
					{transferTarget && (
						<div className="flex items-center gap-4 rounded-2xl border border-neutral-200 p-4">
							<span
								className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white"
								style={getAvatarColorStyle(transferTarget.email)}
							>
								{transferTarget.name.charAt(0).toUpperCase()}
								{transferTarget.hasAvatar && (
									<ProgressiveAvatarImage
										src={`/api/accounts/${transferTarget.id}/avatar`}
										alt=""
										className="absolute inset-0 h-full w-full object-cover"
									/>
								)}
							</span>
							<span className="min-w-0">
								<span className="block truncate font-semibold text-neutral-900">{transferTarget.name}</span>
								<span className="block truncate text-sm text-neutral-500">{transferTarget.email}</span>
							</span>
						</div>
					)}
					<div className="flex justify-end gap-2">
						<DialogClose asChild>
							<Button variant="outline" disabled={transferring}>Cancel</Button>
						</DialogClose>
						<Button disabled={transferring || !transferTarget} onClick={() => void confirmTransfer()}>
							{transferring ? "Transferring..." : "Confirm transfer"}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
