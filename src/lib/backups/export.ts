import { dialectOf, listColumnNames, listTableNames, quoteIdentifier } from "@/db/introspect";
import type { DatabaseDialect } from "@/db/dialect";
import type { BackupTableGroupId, DatabaseBackupDocument, DatabaseBackupTable, DatabaseRecord } from "./types";
import { mergeLegacyMessageBodies } from "./utils";
import { BACKUP_TABLE_GROUPS, getSelectedBackupTables } from "./table-groups";

export const BACKUP_TABLES: DatabaseBackupTable[] = ["users", "user_compose_preferences", "domains", "domain_tracking_hosts", "mailboxes", "mailbox_access", "contacts", "folders", "api_keys", "messages", "message_attachments", "shared_attachment_links", "outbound_jobs", "message_tracking", "message_opens", "follow_ups", "routing_rules", "webhooks", "webhook_deliveries", "sessions", "audit_logs", "backup_settings", "backups", "app_settings", "license_settings", "email_templates", "calendar_events", "booking_events", "auto_reply_deliveries", "spam_token_stats", "spam_reputation", "spam_feedback", "muted_threads", "mailbox_aliases", "linked_accounts", "linked_calendars", "password_reset_tokens", "mfa_recovery_codes", "login_challenges", "passkey_credentials", "mailbox_agent_settings", "agent_conversations", "agent_chat_messages", "agent_jobs", "agent_draft_metadata", "agent_send_approvals", "mcp_key_mailboxes", "ai_usage", "drive_items", "drive_upload_parts", "drive_shares"];
/**
 * Tables every backup document must contain. Tables added to BACKUP_TABLES
 * after the format shipped are absent from older documents, so they stay
 * optional here and are filled in as empty on restore.
 */
/** Added by migrations 0068 and later; databases that have not applied them yet back up and restore without them. */
const LATER_MIGRATION_TABLES: DatabaseBackupTable[] = ["domain_tracking_hosts", "message_tracking", "message_opens", "follow_ups", "user_compose_preferences"];
const REQUIRED_BACKUP_TABLES: DatabaseBackupTable[] = ["users", "domains", "mailboxes", "mailbox_access", "contacts", "folders", "api_keys", "messages", "message_attachments", "outbound_jobs", "routing_rules", "webhooks", "webhook_deliveries", "sessions", "audit_logs", "backup_settings", "backups", "app_settings", "license_settings"];
const INSERT_BATCH_SIZE = 50;
const BACKUP_FORMAT_VERSION = 2;

/**
 * D1 rejects a query whose response exceeds 50 MB, so a table with enough
 * messages (bodies included) cannot be exported in one `SELECT`. Reads page
 * through the table by rowid instead, sizing each page by what earlier pages
 * actually encoded to: row sizes here differ by orders of magnitude, and a
 * limit set for the largest email would slow every other table down.
 */
const EXPORT_PAGE_START_ROWS = 50;
const EXPORT_PAGE_MIN_ROWS = 25;
const EXPORT_PAGE_MAX_ROWS = 10_000;
const EXPORT_PAGE_TARGET_BYTES = 8 * 1024 * 1024;

export function getBackupConfigurationStatus(_env?: CloudflareEnv) {
	return { configured: true, missing: [] };
}

/**
 * Tables D1 manages itself, which are intentionally absent from BACKUP_TABLES.
 */
export const INTERNAL_TABLE_PATTERNS = ["sqlite_%", "_cf%", "messages_fts%"];
const matchesPattern = (name: string, pattern: string) => name.startsWith(pattern.replace(/%$/, ""));
/**
 * The search index is derived data: its triggers repopulate it as messages are
 * restored, so it is neither exported nor part of the coverage check.
 */
export const INTERNAL_TABLES = [
	"d1_migrations",
	// The migration ledger of PostgreSQL and MySQL databases.
	"mailflare_migrations",
	// JMAP state counters, also derived: the jmap_messages_* triggers on
	// `messages` insert and bump a row per mailbox as messages are restored.
	// Exporting it would make restore fail, since the triggers recreate these
	// primary keys before the table's own rows would be inserted.
	"jmap_mailbox_revisions",
	// The JMAP change log is derived the same way (jmap_changes_* triggers);
	// after a restore clients resync because their states no longer apply.
	"jmap_changes",
	"jmap_change_floor",
	// Push registrations are re-sent by each app on launch.
	"push_devices",
	// Web-push subscriptions are saved again by each client whenever it resolves
	// its push state, and they reference sessions whose rows a restore replaces.
	"push_subscriptions",
	// Import jobs are transient progress records tied to staged objects that a backup does not carry.
	"import_jobs",
	// WebAuthn ceremonies, step-up grants and enrolment links are short-lived,
	// single-use bearer secrets. Restoring a stale one would be useless at best
	// and dangerous at worst, so backups deliberately omit them.
	"webauthn_challenges",
	"passkey_enrollment_grants",
	"auth_step_ups",
];

/**
 * Groups a document of this format version was expected to cover. Format 1
 * writers could not have known the drive group, so restoring one only
 * requires the groups that existed when it was written.
 */
function groupsForDocumentVersion(version: DatabaseBackupDocument["version"]): typeof BACKUP_TABLE_GROUPS {
	return version === 2 ? BACKUP_TABLE_GROUPS : BACKUP_TABLE_GROUPS.filter((group) => group.id !== "drive");
}

/**
 * Fails the backup when the database contains a table BACKUP_TABLES does not
 * list. Without this, a migration that adds a table silently produces backups
 * that omit it, and the omission only surfaces during a restore.
 */
export async function assertBackupTablesCoverDatabase(db: D1Database): Promise<Set<string>> {
	const names = [...(await listTableNames(db))].filter((name) => !INTERNAL_TABLE_PATTERNS.some((pattern) => matchesPattern(name, pattern)) && !INTERNAL_TABLES.includes(name));
	const covered = new Set<string>(BACKUP_TABLES);
	const unlisted = names.filter((name) => !covered.has(name));
	if (unlisted.length) throw new Error(`Backup aborted: ${unlisted.join(", ")} not listed in BACKUP_TABLES. Add new tables to src/lib/backups/export.ts and assign each to a group in table-groups.ts.`);
	const assigned = BACKUP_TABLE_GROUPS.flatMap((group) => group.tables);
	const ungrouped = BACKUP_TABLES.filter((table) => assigned.filter((item) => item === table).length !== 1);
	const unknown = assigned.filter((table) => !covered.has(table));
	if (ungrouped.length || unknown.length) throw new Error(`Backup aborted: table groups are out of sync (${[...ungrouped, ...unknown].join(", ")}). Update src/lib/backups/table-groups.ts.`);
	return new Set(names);
}

/**
 * Reads one table's rows for export, yielding bounded pages. Backups hold
 * SQLite-style values whichever database wrote them, so they restore anywhere.
 */
async function* readTablePages(db: D1Database, dialect: DatabaseDialect, table: string): AsyncGenerator<DatabaseRecord[]> {
	if (dialect !== "sqlite") {
		// Only D1 caps a single response at 50 MB; external databases read in one query.
		const result = await db.prepare(`SELECT * FROM ${table}`).all<DatabaseRecord>();
		yield result.results.map(toPortableRecord);
		return;
	}
	// The rowid alias drives the keyset but must not leak into the exported
	// records, whose columns a restore replays verbatim. Deleted rows leave
	// gaps in rowid space, which the `>` comparison steps over. Pages stream
	// out as they are read: a table of messages never sits in memory whole.
	let afterRowId = 0;
	let pageSize = EXPORT_PAGE_START_ROWS;
	for (;;) {
		const limit = pageSize;
		const result = await db
			.prepare(`SELECT rowid AS __export_rowid, * FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ?`)
			.bind(afterRowId, limit)
			.all<DatabaseRecord & { __export_rowid?: number }>();
		const page = result.results;
		if (!page.length) return;
		const lastRowId = page[page.length - 1].__export_rowid;
		if (typeof lastRowId !== "number") throw new Error(`Cannot page through ${table}: rowid is unavailable`);
		afterRowId = lastRowId;
		yield page.map(({ __export_rowid: _rowid, ...record }) => record);
		const bytes = JSON.stringify(page).length;
		if (bytes > EXPORT_PAGE_TARGET_BYTES) pageSize = Math.max(EXPORT_PAGE_MIN_ROWS, Math.floor((pageSize * EXPORT_PAGE_TARGET_BYTES) / bytes));
		else if (bytes < EXPORT_PAGE_TARGET_BYTES / 4) pageSize = Math.min(EXPORT_PAGE_MAX_ROWS, pageSize * 2);
		if (page.length < limit) return;
	}
}

export type BackupStreamWrite = (chunk: Uint8Array) => Promise<void>;

/**
 * Writes the backup document to `write` in bounded chunks, byte-identical to a
 * `JSON.stringify` of the same document. No string ever holds more than a page
 * of rows, so a backup can outgrow both the engine's string limit and the
 * isolate's memory, and the writer never materializes the document whole.
 */
export async function streamDatabaseRecords(db: D1Database, excludedGroups: BackupTableGroupId[] = [], write: BackupStreamWrite): Promise<void> {
	const dialect = dialectOf(db);
	const databaseTables = await assertBackupTablesCoverDatabase(db);
	const selected = getSelectedBackupTables(excludedGroups);
	const includedTables = BACKUP_TABLES.filter((table) => selected.has(table));
	if (!includedTables.length) throw new Error("Select at least one backup table group");
	const encoder = new TextEncoder();
	const emit = (text: string) => write(encoder.encode(text));
	await emit(`{"format":"mailflare-database-backup","version":${BACKUP_FORMAT_VERSION},"createdAt":${JSON.stringify(new Date().toISOString())},"includedTables":${JSON.stringify(includedTables)},"tables":{`);
	for (const [index, table] of includedTables.entries()) {
		const missing = (table === "shared_attachment_links" || table === "booking_events" || table === "passkey_credentials" || table.startsWith("drive_") || LATER_MIGRATION_TABLES.includes(table)) && !databaseTables.has(table);
		await emit(`${index ? "," : ""}${JSON.stringify(table)}:[`);
		if (missing) {
			await emit("]");
			continue;
		}
		let first = true;
		for await (const page of readTablePages(db, dialect, table)) {
			await emit(`${first ? "" : ","}${page.map((row) => JSON.stringify(row)).join(",")}`);
			first = false;
		}
		await emit("]");
	}
	await emit("}}");
}

/** Collects the streamed document into one buffer. Memory-bound: the runner streams instead. */
export async function exportDatabaseRecords(db: D1Database, excludedGroups: BackupTableGroupId[] = []): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let total = 0;
	await streamDatabaseRecords(db, excludedGroups, (chunk) => {
		chunks.push(chunk);
		total += chunk.length;
		return Promise.resolve();
	});
	const document = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		document.set(chunk, offset);
		offset += chunk.length;
	}
	return document;
}

export async function restoreDatabaseRecords(db: D1Database, content: ArrayBuffer): Promise<void> {
	const document = parseDatabaseBackup(content);
	// Format 1 predates the drive group, so its writers could not have named its
	// tables in includedTables; only format 2 documents must cover every group.
	if (document.includedTables && !groupsForDocumentVersion(document.version).every((group) => group.tables.some((table) => document.includedTables?.includes(table)))) throw new Error("This backup contains selected table groups only. Restore requires a backup that includes every table group.");
	mergeLegacyMessageBodies(document);
	fillMissingBackupTables(document);
	validateDatabaseBackup(document);
	const dialect = dialectOf(db);
	const existing = await listTableNames(db);
	const sharedLinksTable = existing.has("shared_attachment_links");
	if (!sharedLinksTable && document.tables.shared_attachment_links?.length) throw new Error("Apply pending database migrations before restoring shared attachment links.");
	const bookingTable = existing.has("booking_events");
	if (!bookingTable && document.tables.booking_events?.length) throw new Error("Apply pending database migrations before restoring booking events.");
	const passkeyTable = existing.has("passkey_credentials");
	if (!passkeyTable && document.tables.passkey_credentials?.length) throw new Error("Apply pending database migrations before restoring passkeys.");
	// Drive migrations ship later than the backup format, so an installation can have a database without them yet.
	const driveTableNames = ["drive_items", "drive_upload_parts", "drive_shares"].filter((table) => existing.has(table));
	if (["drive_items", "drive_upload_parts", "drive_shares"].some((table) => document.tables[table]?.length) && driveTableNames.length !== 3) throw new Error("Apply pending database migrations before restoring the Drive tables.");
	const laterTableNames = LATER_MIGRATION_TABLES.filter((table) => existing.has(table));
	const unmigrated = LATER_MIGRATION_TABLES.filter((table) => document.tables[table]?.length && !laterTableNames.includes(table));
	if (unmigrated.length) throw new Error(`Apply pending database migrations before restoring ${unmigrated.join(", ")}.`);
	const restoreTables = BACKUP_TABLES.filter((table) => (table !== "shared_attachment_links" || sharedLinksTable) && (table !== "booking_events" || bookingTable) && (table !== "passkey_credentials" || passkeyTable) && (!table.startsWith("drive_") || driveTableNames.includes(table)) && (!LATER_MIGRATION_TABLES.includes(table) || laterTableNames.includes(table)));
	const userColumns = await listColumnNames(db, "users");
	const bookingColumns = bookingTable ? await listColumnNames(db, "booking_events") : null;
	// The passkey table can predate later credential columns (aaguid); filter
	// those out instead of failing after the restore has already torn down data.
	const passkeyColumns = passkeyTable ? await listColumnNames(db, "passkey_credentials") : null;
	// Mark users deleted before removing them: the passkey trigger permits the
	// cascade to remove the last credential only for an account that is being
	// purged. Deleting users first also empties the table the restore inserts
	// into last, so the rest of the teardown has no live accounts to protect.
	await db.prepare("UPDATE users SET deleted_at = ?").bind(Math.floor(Date.now() / 1000)).run();
	await db.prepare("DELETE FROM users").run();
	for (const table of [...restoreTables].reverse()) {
		if (table === "users") continue;
		await db.prepare(`DELETE FROM ${table}`).run();
	}
	for (const table of restoreTables) {
		const rows = document.tables[table] ?? [];
		for (let index = 0; index < rows.length; index += INSERT_BATCH_SIZE) {
			const columns = table === "users"
				? userColumns
				: table === "booking_events"
					? bookingColumns
					: table === "passkey_credentials"
						? passkeyColumns
						: null;
			const statements = rows.slice(index, index + INSERT_BATCH_SIZE).map((row) => createInsertStatement(db, dialect, table, row, columns));
			// MySQL checks foreign keys per statement, so the batch suspends them for its own connection.
			if (statements.length > 0) await db.batch(dialect === "mysql" ? [db.prepare("SET FOREIGN_KEY_CHECKS = 0"), ...statements, db.prepare("SET FOREIGN_KEY_CHECKS = 1")] : statements);
		}
	}
}

function parseDatabaseBackup(content: ArrayBuffer): DatabaseBackupDocument {
	let value: unknown;
	try { value = JSON.parse(new TextDecoder().decode(content)); } catch { throw new Error("The selected file is not a valid Mailflare backup"); }
	if (!isDatabaseBackupDocument(value)) throw new Error("The selected file is not a valid Mailflare backup");
	return value;
}

function isDatabaseBackupDocument(value: unknown): value is DatabaseBackupDocument {
	if (!value || typeof value !== "object") return false;
	const document = value as Partial<DatabaseBackupDocument>;
	if (document.format !== "mailflare-database-backup" || typeof document.version !== "number" || ![1, 2].includes(document.version) || !document.tables) return false;
	if (document.includedTables) {
		if (!Array.isArray(document.includedTables) || !document.includedTables.length || new Set(document.includedTables).size !== document.includedTables.length) return false;
		if (!document.includedTables.every((table) => BACKUP_TABLES.includes(table) && Array.isArray(document.tables?.[table]))) return false;
	} else if (!REQUIRED_BACKUP_TABLES.every((table) => Array.isArray(document.tables?.[table]))) return false;
	return BACKUP_TABLES.every((table) => {
		const rows = document.tables?.[table];
		return rows === undefined || Array.isArray(rows);
	});
}

function createInsertStatement(db: D1Database, dialect: DatabaseDialect, table: DatabaseBackupTable, row: DatabaseRecord, availableColumns: Set<string> | null = null) {
	const columns = Object.keys(row).filter((column) => !availableColumns || availableColumns.has(column));
	if (columns.length === 0) throw new Error(`Backup contains an invalid ${table} record`);
	const placeholders = columns.map(() => "?").join(", ");
	const identifiers = columns.map((column) => quoteIdentifier(dialect, column)).join(", ");
	return db.prepare(`INSERT INTO ${table} (${identifiers}) VALUES (${placeholders})`).bind(...columns.map((column) => row[column]));
}

/** Backups written before a table joined BACKUP_TABLES simply omit it. */
function fillMissingBackupTables(document: DatabaseBackupDocument): void {
	for (const table of BACKUP_TABLES) {
		if (!document.tables[table]) document.tables[table] = [];
	}
	for (const row of document.tables.booking_events ?? []) {
		if (row.slug === undefined && typeof row.id === "string") row.slug = Array.from(new TextEncoder().encode(row.id)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	// `require_second_factor` was added after TOTP already existed. A backup from
	// before that column restores with the default false unless it is derived,
	// which would silently turn MFA off for a TOTP-protected user.
	for (const row of document.tables.users ?? []) {
		if (row.require_second_factor === undefined) {
			row.require_second_factor = Number(row.totp_enabled) === 1 ? 1 : 0;
		}
		// The passkey triggers recount credentials as the table is restored.
		// Resetting avoids counting the exported value twice.
		row.passkey_count = 0;
	}
}

function validateDatabaseBackup(document: DatabaseBackupDocument): void {
	for (const table of BACKUP_TABLES) {
		for (const row of document.tables[table] ?? []) {
			if (!row || typeof row !== "object" || Array.isArray(row)) {
				throw new Error(`Backup contains an invalid ${table} record`);
			}
		}
	}
}

function toPortableRecord(row: DatabaseRecord): DatabaseRecord {
	return Object.fromEntries(Object.entries(row).map(([column, value]) => [column, typeof value === "boolean" ? (value ? 1 : 0) : value])) as DatabaseRecord;
}
