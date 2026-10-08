"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Folder, Link2, Server, Upload } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { importMessageFiles } from "@/components/settings/import-messages-utils";
import type {
  ComposioFormState,
  ImapFormState,
  ImportFolderSummary,
  ImportResult,
  ImportSourceItem,
  ImportSourceSection,
  ImportTab,
  ImportProgress,
  LinkedAccountSummary,
  GmailLabelOption,
  ComposioAccountSummary,
} from "./types";
import {
  COMPOSIO_NEW_FOLDER,
  composioSystemDestinations,
  createLinkedAccount,
  ensureImportDestination,
  fetchComposioAccounts,
  fetchGmailLabels,
  fetchImapFolders,
  fetchLinkedAccounts,
  filterCustomImapFolders,
  formatImportResult,
  getComposioDestinationLabel,
  getFolderImportSource,
  getGmailLabelDisplayName,
  getGmailLabelQuery,
  getFileImportSource,
  getSelectedImportSources,
  importFromComposio,
  importFromImap,
  importSourceOptions,
  listMailboxFolders,
  resolveComposioDestination,
  resolveImapSourceFolder,
} from "./utils";

const initialImapForm: ImapFormState = {
  host: "",
  port: "993",
  secure: true,
  username: "",
  password: "",
  folder: "INBOX",
  limit: "100",
  importAll: true,
};

const initialComposioForm: ComposioFormState = {
  connectedAccountId: "",
  query: "",
  limit: "25",
  saveLink: true,
  destination: "system:inbox",
  newFolderName: "",
};

const defaultSections = importSourceOptions.map((option) => option.value);

const SECTION_LABEL_KEYS: Record<ImportSourceSection, TranslationKey> = {
  inbox: "navigation.inbox",
  sent: "navigation.sent",
  drafts: "navigation.drafts",
  archived: "navigation.archived",
  spam: "navigation.spam",
  trash: "navigation.trash",
  others: "importPage.others",
};

export default function SettingsImportPage() {
  const { t } = useLanguage();
  // System sections are translated; folders discovered on the source keep their own names.
  const sourceLabel = (source: ImportSourceItem) => source.sourceSection ? t(SECTION_LABEL_KEYS[source.sourceSection]) : source.label;
  const { selectedMailbox } = useSelectedMailbox();
  const [activeTab, setActiveTab] = useState<ImportTab>("file");
  const [selectedSections, setSelectedSections] =
    useState<ImportSourceSection[]>(defaultSections);
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileResult, setFileResult] = useState<ImportResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileProgress, setFileProgress] = useState<ImportProgress | null>(null);
  const [imapForm, setImapForm] = useState<ImapFormState>(initialImapForm);
  const [imapResult, setImapResult] = useState<ImportResult | null>(null);
  const [imapError, setImapError] = useState<string | null>(null);
  const [imapLoading, setImapLoading] = useState(false);
  const [imapProgress, setImapProgress] = useState<ImportProgress | null>(null);
  const [composioForm, setComposioForm] = useState<ComposioFormState>(initialComposioForm);
  const [composioResult, setComposioResult] = useState<ImportResult | null>(null);
  const [composioError, setComposioError] = useState<string | null>(null);
  const [composioLoading, setComposioLoading] = useState(false);
  const [composioStatus, setComposioStatus] = useState<string | null>(null);
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccountSummary[]>([]);
  const [composioFolders, setComposioFolders] = useState<ImportFolderSummary[]>([]);
  const [gmailLabels, setGmailLabels] = useState<GmailLabelOption[]>([]);
  const [sourceLabelId, setSourceLabelId] = useState("");
  const [composioAccounts, setComposioAccounts] = useState<ComposioAccountSummary[]>([]);

  function applyGmailLabel(labelId: string) {
    setSourceLabelId(labelId);
    if (!labelId) {
      setComposioForm((current) => ({ ...current, query: "" }));
      return;
    }
    const label = gmailLabels.find((item) => item.id === labelId);
    if (label) {
      setComposioForm((current) => ({ ...current, query: getGmailLabelQuery(label) }));
    }
  }

  function loadGmailLabels(accountId: string) {
    const trimmed = accountId.trim();
    if (!trimmed) return;
    fetchGmailLabels(trimmed)
      .then(setGmailLabels)
      .catch(() => setGmailLabels([]));
  }
  const selectedSources = useMemo(
    () => getSelectedImportSources(selectedSections),
    [selectedSections],
  );
  const fileImportSource = getFileImportSource(selectedSources);
  const sourceSummary =
    selectedSources.length > 0
      ? selectedSources.map(sourceLabel).join(", ")
      : t("importPage.selectSections");

  function toggleSection(section: ImportSourceSection, checked: boolean) {
    setSelectedSections((current) => {
      if (checked)
        return current.includes(section) ? current : [...current, section];
      return current.filter((item) => item !== section);
    });
  }

  async function getDestination(source: ImportSourceItem): Promise<string> {
    if (!selectedMailbox?.id) throw new Error(t("importPage.selectMailboxFirst"));
    return ensureImportDestination(selectedMailbox.id, source);
  }

  async function onFileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMailbox?.id || selectedSources.length === 0) return;

    setFileLoading(true);
    setFileError(null);
    setFileResult(null);
    setFileProgress({ completed: 0, total: 100, label: t("importPage.preparing") });
    try {
      const destination = await getDestination(fileImportSource);
      const result = await importMessageFiles(
        selectedMailbox.id,
        files,
        destination,
        (percentage) =>
          setFileProgress({
            completed: percentage,
            total: 100,
            label: percentage < 70 ? t("importPage.uploading") : t("importPage.importingMessages"),
          }),
      );
      setFileResult(result);
      window.dispatchEvent(new Event("mailflare:messages-changed"));
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : t("importPage.fileFailed"),
      );
    } finally {
      setFileLoading(false);
    }
  }

  async function onImapSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMailbox?.id || selectedSources.length === 0) return;
    setImapLoading(true);
    setImapError(null);
    setImapResult(null);
    setImapProgress({
      completed: 0,
      total: 1,
      label: t("importPage.discovering"),
    });
    try {
      const total: ImportResult = { imported: 0, skipped: 0, errors: [] };
      const discoveredFolders = await fetchImapFolders(imapForm);
      const expandedSources: ImportSourceItem[] = [];
      for (const source of selectedSources) {
        if (source.id === "system:others") {
          expandedSources.push(
            ...filterCustomImapFolders(discoveredFolders, selectedSources).map(
              getFolderImportSource,
            ),
          );
        } else {
          expandedSources.push(source);
        }
      }

      for (const [index, source] of expandedSources.entries()) {
        setImapProgress({
          completed: index,
          total: expandedSources.length,
          label: t("importPage.importingSource", { source: sourceLabel(source) }),
        });
        const destination = await getDestination(source);
        const folder = resolveImapSourceFolder(source, discoveredFolders);
        let offset = 0;
        let processed = 0;
        // Newest messages first, one batch per request. Without "import all"
        // only the newest batch is imported.
        while (true) {
          const result = await importFromImap(
            selectedMailbox.id,
            { ...imapForm, folder },
            destination,
            offset,
          );
          total.imported = (total.imported ?? 0) + (result.imported ?? 0);
          total.skipped = (total.skipped ?? 0) + (result.skipped ?? 0);
          total.errors = [...(total.errors ?? []), ...(result.errors ?? [])];
          processed +=
            (result.imported ?? 0) +
            (result.skipped ?? 0) +
            (result.errors?.length ?? 0);
          if (
            !imapForm.importAll ||
            result.nextOffset === null ||
            result.nextOffset === undefined ||
            result.nextOffset <= offset
          )
            break;
          offset = result.nextOffset;
          setImapProgress({
            completed: index,
            total: expandedSources.length,
            label: t("importPage.importingSourceProgress", { source: sourceLabel(source), processed, total: result.total ?? "?" }),
          });
        }
        setImapProgress({
          completed: index + 1,
          total: expandedSources.length,
          label: t("importPage.importedSource", { source: sourceLabel(source) }),
        });
      }
      setImapResult(total);
      setImapForm((current) => ({ ...current, password: "" }));
      window.dispatchEvent(new Event("mailflare:messages-changed"));
    } catch (error) {
      setImapError(
        error instanceof Error ? error.message : t("importPage.imapFailed"),
      );
    } finally {
      setImapLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab !== "composio") return;
    let cancelled = false;
    fetchLinkedAccounts()
      .then((data) => {
        if (!cancelled) setLinkedAccounts(data.accounts);
      })
      .catch(() => {});
    fetchComposioAccounts()
      .then((accounts) => {
        if (!cancelled) setComposioAccounts(accounts);
      })
      .catch(() => {});
    if (selectedMailbox?.id) {
      listMailboxFolders(selectedMailbox.id)
        .then((folders) => {
          if (!cancelled) setComposioFolders(folders);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedMailbox?.id]);

  // An account can only be linked to one mailbox; guard against accidentally
  // moving an existing link by importing from a different selected mailbox.
  const linkedAccountForForm = useMemo(
    () => linkedAccounts.find((item) => item.connectedAccountId === composioForm.connectedAccountId.trim()),
    [linkedAccounts, composioForm.connectedAccountId],
  );
  const linkedElsewhere = Boolean(
    linkedAccountForForm && selectedMailbox?.id && linkedAccountForForm.mailboxId !== selectedMailbox.id,
  );
  const shouldSaveLink = composioForm.saveLink && !linkedElsewhere;

  async function onComposioSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMailbox?.id) return;
    setComposioLoading(true);
    setComposioError(null);
    setComposioResult(null);
    setComposioStatus(shouldSaveLink ? "Linking to mailbox" : "Fetching messages from Gmail");
    try {
      const destination = await resolveComposioDestination(selectedMailbox.id, composioForm);
      if (shouldSaveLink) {
        await createLinkedAccount(selectedMailbox.id, composioForm, destination);
      }
      setComposioStatus("Fetching messages from Gmail");
      const result = await importFromComposio(selectedMailbox.id, composioForm, destination);
      setComposioResult(result);
      setComposioStatus(null);
      window.dispatchEvent(new Event("mailflare:messages-changed"));
      fetchLinkedAccounts()
        .then((data) => setLinkedAccounts(data.accounts))
        .catch(() => {});
    } catch (error) {
      setComposioStatus(null);
      setComposioError(
        error instanceof Error ? error.message : "Composio import failed",
      );
    } finally {
      setComposioLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* <div>
        <h1 className="text-2xl md:text-3xl font-medium text-neutral-900">Import</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Move mail from selected source sections into the matching sections of
          the current mailbox.
        </p>
      </div> */}

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">
            {t("importPage.title")}
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            {t("importPage.description")}
          </p>
        </div>
        <div className="space-y-1 overflow-hidden rounded-3xl">
          <CardContent className="space-y-6 rounded-b-lg rounded-t-3xl bg-white p-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="import-source">{t("importPage.source")}</Label>
              <Select
                id="import-source"
                value={activeTab}
                onChange={(event) =>
                  setActiveTab(event.target.value as ImportTab)
                }
                className="text-sm w-full py-2"
                // className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 shadow-sm shadow-neutral-200/50 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option value="file">{t("importPage.backupFile")}</option>
                <option value="imap">{t("importPage.imap")}</option>
                <option value="composio">{t("importPage.gmailComposio")}</option>
              </Select>
            </div>
            {activeTab !== "composio" && (
            <div className="space-y-2">
              <Label>{t("importPage.chooseSections")}</Label>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSourceDropdownOpen((open) => !open)}
                  className="flex w-full items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2 text-left text-sm shadow-sm shadow-neutral-200/50"
                >
                  <label className="flex-1">{t("importPage.selected")}</label>
                  <span className="truncate">{sourceSummary}</span>
                  <span className="text-neutral-400 px-2">▾</span>
                </button>
                {sourceDropdownOpen && (
                  <div className="absolute z-20 mt-2 w-full rounded-xl border border-neutral-200 bg-white p-2 shadow-lg">
                    {importSourceOptions.map((option) => (
                      <label
                        key={option.value}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                      >
                        <Checkbox
                          checked={selectedSections.includes(option.value)}
                          onChange={(event) =>
                            toggleSection(option.value, event.target.checked)
                          }
                        />
                        {t(SECTION_LABEL_KEYS[option.value])}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {/* <p className="text-xs leading-5 text-neutral-500">
            Select Folders to import every source IMAP folder into matching
            Mailflare folders.
          </p> */}
            </div>
            )}

            {activeTab === "file" ? (
              <>
                <form onSubmit={onFileSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t("importPage.selectFile")}</Label>
                    <Input
                      id="import-files"
                      type="file"
                      accept=".eml,.mbox,.mbx,message/rfc822,application/mbox"
                      multiple
                      onChange={(event) =>
                        setFiles(Array.from(event.target.files ?? []))
                      }
                      className="block w-full rounded-md border border-neutral-200 bg-white px-3 py-1 text-sm shadow-sm shadow-neutral-200/50 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-sm file:font-medium"
                    />
                    <p className="text-xs leading-5 text-neutral-500">
                      {t("importPage.fileHint", { section: sourceLabel(fileImportSource) })}
                    </p>
                  </div>
                  {selectedSections.includes("others") && (
                    <p className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                      {t("importPage.othersNote")}
                    </p>
                  )}
                  <Button
                    type="submit"
                    disabled={
                      !selectedMailbox ||
                      selectedSources.length === 0 ||
                      files.length === 0 ||
                      fileLoading
                    }
                  >
                    {fileLoading ? t("import.importing") : t("importPage.importFiles")}
                  </Button>
                  {fileProgress && (
                    <div
                      className="space-y-1 text-xs text-neutral-500"
                      aria-live="polite"
                    >
                      <div className="flex justify-between">
                        <span>{fileProgress.label}</span>
                        <span>{fileProgress.completed}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                        <div
                          className="h-full bg-blue-600 transition-[width]"
                          style={{ width: `${fileProgress.completed}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {fileResult && (
                    <p className="rounded-lg border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-700">
                      {formatImportResult(fileResult, t)}
                    </p>
                  )}
                  {fileError && (
                    <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {fileError}
                    </p>
                  )}
                </form>
              </>
            ) : activeTab === "imap" ? (
              <>
                <form onSubmit={onImapSubmit} className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-[1fr_110px]">
                    <div className="space-y-2">
                      <Label htmlFor="imap-host">{t("importPage.host")}</Label>
                      <Input
                        id="imap-host"
                        value={imapForm.host}
                        onChange={(event) =>
                          setImapForm({ ...imapForm, host: event.target.value })
                        }
                        placeholder="imap.gmail.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="imap-port">{t("importPage.port")}</Label>
                      <Input
                        id="imap-port"
                        type="number"
                        value={imapForm.port}
                        onChange={(event) =>
                          setImapForm({ ...imapForm, port: event.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="imap-username">{t("importPage.username")}</Label>
                      <Input
                        id="imap-username"
                        value={imapForm.username}
                        onChange={(event) =>
                          setImapForm({
                            ...imapForm,
                            username: event.target.value,
                          })
                        }
                        placeholder="you@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="imap-password">
                        {t("importPage.passwordOrApp")}
                      </Label>
                      <Input
                        id="imap-password"
                        type="password"
                        value={imapForm.password}
                        onChange={(event) =>
                          setImapForm({
                            ...imapForm,
                            password: event.target.value,
                          })
                        }
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="imap-limit">
                        {imapForm.importAll
                          ? t("importPage.perBatch")
                          : t("importPage.perSource")}
                      </Label>
                      <Input
                        id="imap-limit"
                        type="number"
                        min={1}
                        max={100}
                        value={imapForm.limit}
                        onChange={(event) =>
                          setImapForm({
                            ...imapForm,
                            limit: event.target.value,
                          })
                        }
                      />
                    </div>
                    <label className="flex items-end gap-2 pb-2 text-sm text-neutral-700">
                      <Checkbox
                        checked={imapForm.importAll}
                        onChange={(event) =>
                          setImapForm({
                            ...imapForm,
                            importAll: event.target.checked,
                          })
                        }
                      />
                      {t("importPage.importAll")}
                    </label>
                    <label className="flex items-end gap-2 pb-2 text-sm text-neutral-700">
                      <Checkbox
                        checked={imapForm.secure}
                        onChange={(event) =>
                          setImapForm({
                            ...imapForm,
                            secure: event.target.checked,
                          })
                        }
                      />
                      {t("importPage.useTls")}
                    </label>
                  </div>
                  <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs leading-5 text-neutral-500">
                    {t("importPage.imapNote")}
                  </p>
                  <Button
                    type="submit"
                    disabled={
                      !selectedMailbox ||
                      selectedSources.length === 0 ||
                      !imapForm.host ||
                      !imapForm.username ||
                      !imapForm.password ||
                      imapLoading
                    }
                  >
                    <Upload className="h-4 w-4" />
                    {imapLoading ? t("import.importing") : t("importPage.importSources")}
                  </Button>
                  {imapProgress && (
                    <div
                      className="space-y-1 text-xs text-neutral-500"
                      aria-live="polite"
                    >
                      <div className="flex justify-between">
                        <span>{imapProgress.label}</span>
                        <span>
                          {imapProgress.completed}/{imapProgress.total}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                        <div
                          className="h-full bg-blue-600 transition-[width]"
                          style={{
                            width: `${Math.round((imapProgress.completed / imapProgress.total) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                  {imapResult && (
                    <p className="rounded-lg border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-700">
                      {formatImportResult(imapResult, t)}
                    </p>
                  )}
                  {imapError && (
                    <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {imapError}
                    </p>
                  )}
                </form>
              </>
            ) : (
              <>
                <form onSubmit={onComposioSubmit} className="space-y-4">
                  {composioAccounts.length > 0 && (
                    <div className="space-y-2">
                      <Label htmlFor="composio-saved">Gmail accounts from Composio</Label>
                      <Select
                        id="composio-saved"
                        value={composioAccounts.some((account) => account.connectedAccountId === composioForm.connectedAccountId.trim()) ? composioForm.connectedAccountId.trim() : ""}
                        onChange={(event) => {
                          const accountId = event.target.value;
                          if (!accountId) return;
                          setComposioForm((current) => ({ ...current, connectedAccountId: accountId }));
                          loadGmailLabels(accountId);
                        }}
                        className="text-sm w-full py-2"
                      >
                        <option value="">Choose a Gmail account…</option>
                        {composioAccounts.map((account) => {
                          const linked = linkedAccounts.find(
                            (item) => item.connectedAccountId === account.connectedAccountId,
                          );
                          const mailboxLabel = linked
                            ? ` — linked to ${linked.mailboxName ?? linked.mailboxLocalPart ?? linked.mailboxId}`
                            : "";
                          return (
                            <option key={account.connectedAccountId} value={account.connectedAccountId}>
                              {account.email ?? account.connectedAccountId}
                              {mailboxLabel}
                            </option>
                          );
                        })}
                      </Select>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="composio-account">
                      Composio connected account ID
                    </Label>
                    <Input
                      id="composio-account"
                      value={composioForm.connectedAccountId}
                      onChange={(event) =>
                        setComposioForm({
                          ...composioForm,
                          connectedAccountId: event.target.value,
                        })
                      }
                      onBlur={(event) => loadGmailLabels(event.target.value)}
                      placeholder="ca_..."
                      autoComplete="off"
                    />
                    <p className="text-xs leading-5 text-neutral-500">
                      Find the ID under Connected Accounts at
                      app.composio.dev. Your Composio API key is configured on
                      the server, and your Google token never reaches Mailflare.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="composio-source-label">Gmail folder (source)</Label>
                    <Select
                      id="composio-source-label"
                      value={sourceLabelId}
                      onChange={(event) => applyGmailLabel(event.target.value)}
                      className="text-sm w-full py-2"
                    >
                      <option value="">All mail (or use a custom query below)</option>
                      {gmailLabels.length > 0 && (
                        <optgroup label="System">
                          {gmailLabels
                            .filter((label) => label.type === "system")
                            .map((label) => (
                              <option key={label.id} value={label.id}>
                                {getGmailLabelDisplayName(label)}
                              </option>
                            ))}
                        </optgroup>
                      )}
                      {gmailLabels.some((label) => label.type === "user") && (
                        <optgroup label="Labels">
                          {gmailLabels
                            .filter((label) => label.type === "user")
                            .map((label) => (
                              <option key={label.id} value={label.id}>
                                {getGmailLabelDisplayName(label)}
                              </option>
                            ))}
                        </optgroup>
                      )}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="composio-query">
                      Gmail search query (optional)
                    </Label>
                    <Input
                      id="composio-query"
                      value={composioForm.query}
                      onChange={(event) => {
                        setSourceLabelId("");
                        setComposioForm({
                          ...composioForm,
                          query: event.target.value,
                        });
                      }}
                      placeholder='e.g. "in:inbox" or "from:news@example.com"'
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="composio-destination">
                        Import destination
                      </Label>
                      <Select
                        id="composio-destination"
                        value={composioForm.destination}
                        onChange={(event) =>
                          setComposioForm({
                            ...composioForm,
                            destination: event.target.value,
                          })
                        }
                        className="text-sm w-full py-2"
                      >
                        <optgroup label="Mail sections">
                          {composioSystemDestinations.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Folders">
                          {composioFolders.map((folder) => (
                            <option key={folder.id} value={`folder:${folder.id}`}>
                              {folder.name}
                            </option>
                          ))}
                          <option value={COMPOSIO_NEW_FOLDER}>
                            New folder…
                          </option>
                        </optgroup>
                      </Select>
                    </div>
                    {composioForm.destination === COMPOSIO_NEW_FOLDER && (
                      <div className="space-y-2">
                        <Label htmlFor="composio-new-folder">
                          New folder name
                        </Label>
                        <Input
                          id="composio-new-folder"
                          value={composioForm.newFolderName}
                          onChange={(event) =>
                            setComposioForm({
                              ...composioForm,
                              newFolderName: event.target.value,
                            })
                          }
                          placeholder="e.g. Gmail"
                        />
                      </div>
                    )}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="composio-limit">Message limit</Label>
                      <Input
                        id="composio-limit"
                        type="number"
                        min={1}
                        max={50}
                        value={composioForm.limit}
                        onChange={(event) =>
                          setComposioForm({
                            ...composioForm,
                            limit: event.target.value,
                          })
                        }
                      />
                    </div>
                    <label className="flex items-end gap-2 pb-2 text-sm text-neutral-700">
                      <Checkbox
                        checked={composioForm.saveLink}
                        disabled={linkedElsewhere}
                        onChange={(event) =>
                          setComposioForm({
                            ...composioForm,
                            saveLink: event.target.checked,
                          })
                        }
                      />
                      Link this account to {selectedMailbox?.localPart ?? "this mailbox"} for future syncing
                    </label>
                  </div>
                  {linkedElsewhere && (
                    <p className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                      This account is already linked to{" "}
                      {linkedAccountForForm?.mailboxName ?? linkedAccountForForm?.mailboxLocalPart ?? "another mailbox"}
                      . You can import from it here without changing that link.
                    </p>
                  )}
                  <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs leading-5 text-neutral-500">
                    Messages are imported into{" "}
                    {getComposioDestinationLabel(composioForm.destination, composioFolders)}{" "}
                    of {selectedMailbox?.localPart ?? "the selected mailbox"}.
                    Existing messages are skipped automatically.
                  </p>
                  <Button
                    type="submit"
                    disabled={
                      !selectedMailbox ||
                      !composioForm.connectedAccountId ||
                      composioLoading
                    }
                  >
                    <Link2 className="h-4 w-4" />
                    {composioLoading ? "Importing..." : "Import from Gmail"}
                  </Button>
                  {composioStatus && (
                    <div
                      className="space-y-1 text-xs text-neutral-500"
                      aria-live="polite"
                    >
                      {composioStatus}
                    </div>
                  )}
                  {composioResult && (
                    <p className="rounded-lg border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-700">
                      {formatImportResult(composioResult)}
                    </p>
                  )}
                  {composioError && (
                    <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {composioError}
                    </p>
                  )}
                </form>
              </>
            )}
          </CardContent>
        </div>
      </section>
    </div>
  );
}
