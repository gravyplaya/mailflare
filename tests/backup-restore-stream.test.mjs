import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import Database from "better-sqlite3";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "node_modules", ".cache", "backup-restore-stream");
const outfile = join(outDir, "restore.mjs");
await build({
	stdin: {
		contents: 'export * from "./src/lib/backups/export"; export * from "./src/lib/backups/restore-stream";',
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
const { exportDatabaseRecords, restoreDatabaseBackupStream, scanBackupStream } = await import(pathToFileURL(outfile).href);
const { migrations } = JSON.parse(readFileSync(join(root, "src/lib/migrations/bundle.json"), "utf8"));

/**
 * A D1 facade over the migrated in-memory database, with the methods the
 * restore path touches: raw statements for teardown, bound all/run for inserts.
 */
function d1(sqlite) {
	const prepare = (sql) => {
		const statement = {
			values: [],
			bind(...values) {
				statement.values = values;
				return statement;
			},
			async all() {
				return { results: sqlite.prepare(sql).all(...statement.values), success: true, meta: {} };
			},
			async raw() {
				return Promise.resolve(sqlite.prepare(sql).raw().all(...statement.values));
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

function addUser(sqlite, id, email) {
	sqlite.prepare(
		`INSERT INTO users (
			id, email, password_hash, name, role, is_primary_admin, disabled, can_manage_mailboxes,
			can_manage_domains, can_manage_users, keyboard_shortcuts_enabled, spam_protection_enabled,
			show_full_recipient_addresses, remote_content_mode, require_second_factor, totp_enabled, created_at
		) VALUES (?, ?, 'x', 'User', 'user', 0, 0, 0, 0, 0, 1, 1, 0, 'allow', 0, 0, 1)`,
	).run(id, email);
}

/** Bodies exercise every character the scanner must not trip on. */
const TRICKY_BODY = `<div data-x='{"nested": {"deep": [1,2]}}'>He said "hi"\\n\\ back\\ "slash"</div><p>ünïcode ✓ 😀</p>\n{"not a table":[`;

function addUserWithMessages(sqlite, id, email) {
	addUser(sqlite, id, email);
	sqlite.prepare(
		"INSERT INTO passkey_credentials (id, user_id, credential_id, credential_hash, public_key, counter, device_type, backed_up, name, created_at) VALUES ('p1', ?, 'c1', 'h1', 'key', 0, 'singleDevice', 0, 'Test', 1)",
	).run(id);
	const insert = sqlite.prepare(
		"INSERT INTO messages (id, user_id, direction, from_addr, to_addr, status, html_body, created_at) VALUES (?, ?, 'inbound', 'a@example.test', 'b@example.test', 'received', ?, 1)",
	);
	for (let index = 1; index <= 3; index++) insert.run(`m${index}`, id, `${TRICKY_BODY} #${index}`);
}

/** Replays the bytes in fixed-size chunks, splitting inside characters on purpose. */
function streamOf(bytes, chunkSize) {
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset >= bytes.length) {
				controller.close();
				return;
			}
			const end = Math.min(offset + chunkSize, bytes.length);
			controller.enqueue(bytes.subarray(offset, end));
			offset = end;
		},
	});
}

async function exportedBytes(sqlite) {
	return Buffer.from(await exportDatabaseRecords(d1(sqlite)));
}

test("the scanner reconstructs the document one record at a time, even one byte per chunk", async () => {
	const sqlite = database();
	addUserWithMessages(sqlite, "u1", "u1@example.test");
	const bytes = await exportedBytes(sqlite);
	const document = JSON.parse(bytes.toString("utf8"));

	const recorded = { header: null, tables: [], rows: [] };
	await scanBackupStream(streamOf(bytes, 1), {
		onHeader: (header) => {
			recorded.header = header;
		},
		onTable: (table) => {
			recorded.tables.push(table);
		},
		onRow: (table, row) => {
			recorded.rows.push([table, row]);
		},
	});

	assert.equal(recorded.header.version, 2);
	assert.deepEqual(recorded.header.includedTables, document.includedTables);
	assert.deepEqual(recorded.tables, document.includedTables);
	const rebuilt = {};
	for (const table of recorded.tables) rebuilt[table] = [];
	for (const [table, row] of recorded.rows) rebuilt[table].push(row);
	assert.deepEqual(rebuilt, document.tables);
});

test("a truncated or malformed stream is rejected, never partially parsed", async () => {
	const sqlite = database();
	addUser(sqlite, "u1", "u1@example.test");
	const bytes = await exportedBytes(sqlite);

	await assert.rejects(scanBackupStream(streamOf(bytes.subarray(0, bytes.length - 12), 5), { onHeader() {}, onTable() {}, onRow() {} }), /not a valid Mailflare backup/);
	await assert.rejects(scanBackupStream(streamOf(Buffer.from('{"format":"mailflare-database-backup","version":2,"createdAt":"x"'), 5), { onHeader() {}, onTable() {}, onRow() {} }), /not a valid Mailflare backup/);
	await assert.rejects(scanBackupStream(streamOf(Buffer.from("not json at all"), 5), { onHeader() {}, onTable() {}, onRow() {} }), /not a valid Mailflare backup/);
});

test("a stored backup restores record by record into a fresh database", async () => {
	const source = database();
	addUserWithMessages(source, "u1", "u1@example.test");
	const bytes = await exportedBytes(source);

	const target = database();
	await restoreDatabaseBackupStream(d1(target), () => Promise.resolve(streamOf(bytes, 7)));

	assert.equal(target.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);
	assert.equal(target.prepare("SELECT COUNT(*) AS count FROM passkey_credentials").get().count, 1);
	assert.equal(target.prepare("SELECT passkey_count FROM users WHERE id = 'u1'").get().passkey_count, 1);
	assert.equal(target.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 3);
	const bodies = target.prepare("SELECT id, html_body FROM messages ORDER BY id").all();
	const expected = source.prepare("SELECT id, html_body FROM messages ORDER BY id").all();
	assert.deepEqual(bodies, expected);
});

test("a corrupted record aborts during validation, before any data is torn down", async () => {
	const source = database();
	addUserWithMessages(source, "u1", "u1@example.test");
	const bytes = await exportedBytes(source);
	const broken = bytes.toString("utf8").replace(/"passkey_credentials":\[\{/, '"passkey_credentials":[X{');

	const target = database();
	addUser(target, "u2", "u2@example.test");
	await assert.rejects(
		restoreDatabaseBackupStream(d1(target), () => Promise.resolve(streamOf(Buffer.from(broken), 64))),
		/not a valid Mailflare backup/,
	);
	const [user] = target.prepare("SELECT id FROM users").all();
	assert.equal(user.id, "u2", "validation must run before the teardown touches anything");
});

test("a backup carrying legacy tables is rejected with a pointer to the file restore", async () => {
	const source = database();
	addUserWithMessages(source, "u1", "u1@example.test");
	const bytes = await exportedBytes(source);
	const poisoned = bytes.toString("utf8").replace('"tables":{', '"tables":{"message_bodies":[],');

	const target = database();
	addUser(target, "u2", "u2@example.test");
	await assert.rejects(
		restoreDatabaseBackupStream(d1(target), () => Promise.resolve(streamOf(Buffer.from(poisoned), 64))),
		/predates the streaming restore format/,
	);
	assert.equal(target.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);
});

test("a backup missing a table group, or older than format 2, points at the file restore", async () => {
	const source = database();
	addUserWithMessages(source, "u1", "u1@example.test");
	const partial = Buffer.from(await exportDatabaseRecords(d1(source), ["drive"]));
	const older = Buffer.from((await exportedBytes(source)).toString("utf8").replace('"version":2', '"version":1'));

	const target = database();
	await assert.rejects(
		restoreDatabaseBackupStream(d1(target), () => Promise.resolve(streamOf(partial, 64))),
		/includes every table group/,
	);
	await assert.rejects(
		restoreDatabaseBackupStream(d1(target), () => Promise.resolve(streamOf(older, 64))),
		/Streaming restore supports format 2/,
	);
	assert.equal(target.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0, "rejections must never tear the database down");
});

test("a database missing tables the backup needs is rejected before the teardown", async () => {
	const source = database();
	addUserWithMessages(source, "u1", "u1@example.test");
	const bytes = await exportedBytes(source);

	const target = database();
	addUser(target, "u2", "u2@example.test");
	target.exec("DROP TABLE passkey_credentials");
	await assert.rejects(
		restoreDatabaseBackupStream(d1(target), () => Promise.resolve(streamOf(bytes, 64))),
		/Apply pending database migrations before restoring passkeys/,
	);
	assert.equal(target.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);
});
