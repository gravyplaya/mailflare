"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { ManagedAccount, ManagedDomain, ManagedMailbox } from "../types";
import {
  addManagedMailbox,
  fetchManagedAccount,
  fetchManagedDomains,
  fetchManagedMailboxes,
  removeManagedMailbox,
} from "../utils";

export default function AccountMailboxesPage() {
  const { id } = useParams<{ id: string }>();
  const [account, setAccount] = useState<ManagedAccount | null>(null);
  const [mailboxes, setMailboxes] = useState<ManagedMailbox[]>([]);
  const [domains, setDomains] = useState<ManagedDomain[]>([]);
  const [localPart, setLocalPart] = useState("");
  const [domainId, setDomainId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [nextAccount, nextMailboxes, nextDomains] = await Promise.all([
      fetchManagedAccount(id),
      fetchManagedMailboxes(id),
      fetchManagedDomains(),
    ]);
    setAccount(nextAccount);
    setMailboxes(nextMailboxes);
    setDomains(nextDomains);
    setDomainId((current) => current || nextDomains[0]?.id || "");
  }

  useEffect(() => {
    void load().catch((error) =>
      setMessage(
        error instanceof Error ? error.message : "Unable to load mailboxes",
      ),
    );
  }, [id]);

  async function addMailbox(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    setSaving(true);
    setMessage(null);
    try {
      await addManagedMailbox(account, { domainId, localPart });
      setLocalPart("");
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to add mailbox",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeMailbox(mailboxId: string) {
    setMessage(null);
    try {
      await removeManagedMailbox(mailboxId);
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to remove mailbox",
      );
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-medium text-neutral-900">Mailboxes</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Manage inboxes owned by {account?.name ?? "this account"}.
        </p>
      </div>
      <section className="space-y-4 rounded-3xl bg-white p-6">
        <h2 className="text-base font-semibold text-neutral-900">Current inboxes</h2>
        <div className="space-y-2">
          {mailboxes.map((mailbox) => (
            <div
              key={mailbox.id}
              className="flex items-center justify-between rounded-2xl bg-neutral-50 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {mailbox.displayName || mailbox.localPart}
                </span>
                <span className="block truncate text-sm text-neutral-500">
                  {mailbox.localPart}@{mailbox.hostname}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => void removeMailbox(mailbox.id)}
                aria-label="Remove inbox"
              >
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            </div>
          ))}
          {account && mailboxes.length === 0 && (
            <p className="text-sm text-neutral-500">No mailboxes yet.</p>
          )}
        </div>
        <div className="border-t border-neutral-200 pt-6">
          <h2 className="text-base font-semibold text-neutral-900">Add an inbox</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Choose an inbox name and domain for this account.
          </p>
          <form onSubmit={addMailbox} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <Label htmlFor="inbox-name">Inbox name</Label>
                <Input
                  id="inbox-name"
                  value={localPart}
                  onChange={(event) => setLocalPart(event.target.value)}
                  placeholder="inbox"
                  disabled={!account || saving}
                  maxLength={64}
                  required
                />
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor="inbox-domain">Domain</Label>
                <Select
                  id="inbox-domain"
                  value={domainId}
                  onChange={(event) => setDomainId(event.target.value)}
                  containerClassName="h-10 w-full min-w-0 bg-white"
                  className="min-w-0 text-sm"
                  disabled={!account || domains.length === 0 || saving}
                  required
                >
                  {domains.length === 0 && <option value="">No domains available</option>}
                  {domains.map((domain) => (
                    <option key={domain.id} value={domain.id}>
                      {domain.hostname}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {domainId && (
              <p className="break-all text-sm text-neutral-500">
                Address: <span className="font-medium text-neutral-900">{localPart || "inbox"}@{domains.find((domain) => domain.id === domainId)?.hostname}</span>
              </p>
            )}
            <Button type="submit" disabled={!account || !domainId || !localPart.trim() || saving}>
              <Plus className="h-4 w-4" />
              {saving ? "Adding..." : "Add inbox"}
            </Button>
          </form>
        </div>
      </section>
      {message && <p className="text-sm text-neutral-500">{message}</p>}
    </div>
  );
}
