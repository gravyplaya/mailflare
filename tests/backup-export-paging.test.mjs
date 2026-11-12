import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import Database from "better-sqlite3";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "node_modules", ".cache", "backup-export-paging");
const outfile = join(outDir, "backup.mjs");
await build({
	stdin: {
		contents: 'export * from "./src/lib/backups/export";',
		resolveDir: root,
		loader: "ts",
	},
	outfile,
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	logLevel: "silent",
	alias: { "@": join(root, "src") },
	banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
const { exportDatabaseRecords, streamDatabaseRecords } = await import(pathToFileURL(outfile).href);
const { migrations } = JSON.parse(readFileSync(join(root, "src/lib/migrations/bundle.json"), "utf8"));

const MESSAGE_COUNT = 250;
const BODY_BYTES = 170_000;

/**
 * D1 refuses a single query response larger than 50 MB, so the export pages
 * through each table by rowid. This facade records how many of those paged
 * queries ran so the test can tell paging happened.
 */
function d1(sqlite) {
	let pagedQueries = 0;
	const prepare = (sql) => {
		const statement = {
			values: [],
			bind(...values) {
				statement.values = values;
				return statement;
			},
			async all() {
				if (sql.includes("__export_rowid")) pagedQueries++;
				return { results: sqlite.prepare(sql).all(...statement.values), success: true, meta: {} };
			},
			async run() {
				const result = sqlite.prepare(sql).run(...statement.values);
				return { results: [], success: true, meta: { changes: result.changes } };
			},
			async first() {
				return sqlite.prepare(sql).get(...statement.values) ?? null;
			},
		};
		return statement;
	};
	return {
		prepare,
		pagedQueries: () => pagedQueries,
		async batch(statements) {
			return Promise.all(statements.map((statement) => statement.run()));
		},
	};
}

function database() {
	const sqlite = new Database(":memory:");
	sqlite.pragma("foreign_keys = OFF");
	for (const migration of migrations) {
		for (const statement of migration.statements) sqlite.exec(statement);
	}
	return sqlite;
}

/** The body is large enough that a naive single-row-limit page would still overshoot D1's response cap. */
function addMessages(sqlite) {
	sqlite.prepare(
		`INSERT INTO users (
			id, email, password_hash, name, role, is_primary_admin, disabled, can_manage_mailboxes,
			can_manage_domains, can_manage_users, keyboard_shortcuts_enabled, spam_protection_enabled,
			show_full_recipient_addresses, remote_content_mode, require_second_factor, totp_enabled, created_at
		) VALUES ('u1', 'u1@example.test', 'x', 'User', 'user', 0, 0, 0, 0, 0, 1, 1, 0, 'allow', 0, 0, 1)`,
	).run();
	const insert = sqlite.prepare(
		"INSERT INTO messages (id, user_id, direction, from_addr, to_addr, status, html_body, created_at) VALUES (?, 'u1', 'inbound', 'a@example.test', 'b@example.test', 'received', ?, 1)",
	);
	for (let index = 1; index <= MESSAGE_COUNT; index++) insert.run(`m${index}`, `<p>${"x".repeat(BODY_BYTES)}</p>`);
	// Deleted rows leave gaps in rowid space; a quarter of the table goes away
	// so the keyset has to step over them.
	const remove = sqlite.prepare("DELETE FROM messages WHERE id = ?");
	for (let index = 10; index <= MESSAGE_COUNT; index += 10) remove.run(`m${index}`);
}

test("exporting a table too big for one D1 response pages through it by rowid", { timeout: 60_000 }, async () => {
	const sqlite = database();
	addMessages(sqlite);
	const handle = d1(sqlite);
	const backup = await exportDatabaseRecords(handle);
	const document = JSON.parse(Buffer.from(backup).toString("utf8"));

	assert.equal(document.tables.messages.length, MESSAGE_COUNT - MESSAGE_COUNT / 10);
	const ids = new Set(document.tables.messages.map((row) => row.id));
	assert.equal(ids.size, document.tables.messages.length, "paging duplicated rows");
	assert.equal(ids.has("m10"), false, "a deleted row came back");
	assert.equal(ids.has("m1"), true, "the first row is missing");
	assert.equal(ids.has(`m${MESSAGE_COUNT - 1}`), true, "the last surviving row is missing");
	assert.equal(ids.has(`m${MESSAGE_COUNT}`), false, "the last row was deleted, not exported");
	assert.ok(handle.pagedQueries() >= 3, `expected several paged queries, saw ${handle.pagedQueries()}`);
	assert.equal(document.tables.users.length, 1);

	for (const row of [...document.tables.messages, ...document.tables.users]) {
		assert.equal("__export_rowid" in row, false, "the rowid alias leaked into the backup");
	}
});

test("the streamed document is byte-identical to the collected export", async () => {
	const sqlite = database();
	sqlite.prepare(
		`INSERT INTO users (
			id, email, password_hash, name, role, is_primary_admin, disabled, can_manage_mailboxes,
			can_manage_domains, can_manage_users, keyboard_shortcuts_enabled, spam_protection_enabled,
			show_full_recipient_addresses, remote_content_mode, require_second_factor, totp_enabled, created_at
		) VALUES ('u1', 'u1@example.test', 'x', 'User', 'user', 0, 0, 0, 0, 0, 1, 1, 0, 'allow', 0, 0, 1)`,
	).run();
	const insert = sqlite.prepare(
		"INSERT INTO messages (id, user_id, direction, from_addr, to_addr, status, html_body, created_at) VALUES (?, 'u1', 'inbound', 'a@example.test', 'b@example.test', 'received', ?, 1)",
	);
	for (let index = 1; index <= 30; index++) insert.run(`m${index}`, `<p>body ${index} — ünïcode ✓</p>`);

	const collected = Buffer.from(await exportDatabaseRecords(d1(sqlite))).toString("utf8");
	const chunks = [];
	await streamDatabaseRecords(d1(sqlite), [], async (chunk) => chunks.push(chunk));
	const streamed = Buffer.concat(chunks).toString("utf8");

	// The only difference between two runs is the createdAt timestamp.
	const stamp = collected.match(/"createdAt":"[^"]*"/)[0];
	assert.equal(streamed.replace(/"createdAt":"[^"]*"/, stamp), collected);
	assert.match(streamed, /^\{"format":"mailflare-database-backup","version":2,"createdAt":"/);
	assert.match(streamed, /\}\}$/);
	assert.ok(chunks.length > 30, `the stream should emit many chunks, saw ${chunks.length}`);
});
