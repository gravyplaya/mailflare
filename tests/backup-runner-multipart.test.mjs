import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import Database from "better-sqlite3";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "node_modules", ".cache", "backup-runner-multipart");
const outfile = join(outDir, "runner.mjs");
await build({
	stdin: {
		contents: 'export * from "./src/lib/backups/runner";',
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
const { runDatabaseBackup, BackupPartBuffer } = await import(pathToFileURL(outfile).href);
const { migrations } = JSON.parse(readFileSync(join(root, "src/lib/migrations/bundle.json"), "utf8"));

/**
 * A D1 facade over the migrated in-memory database, with the methods drizzle's
 * d1 driver touches: bind/run for writes, bind/all for unmapped rows, and
 * bind/raw for selects drizzle maps from column arrays.
 */
function d1(sqlite, options = {}) {
	const prepare = (sql) => {
		const statement = {
			values: [],
			bind(...values) {
				statement.values = values;
				return statement;
			},
			async all() {
				if (options.failPaged && sql.includes("__export_rowid")) throw new Error(options.failPaged);
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
	return { prepare };
}

function database() {
	const sqlite = new Database(":memory:");
	sqlite.pragma("foreign_keys = OFF");
	for (const migration of migrations) {
		for (const statement of migration.statements) sqlite.exec(statement);
	}
	return sqlite;
}

function addQueuedBackup(sqlite, id = "b1") {
	sqlite.prepare("INSERT INTO backups (id, trigger, status, created_at) VALUES (?, 'manual', 'queued', 1)").run(id);
}

/** A fake multipart bucket recording every call the runner makes. */
function fakeBucket() {
	const state = { key: null, options: null, parts: [], aborted: false, completed: null, size: null };
	const bucket = {
		createMultipartUpload: async (key, options) => {
			state.key = key;
			state.options = options;
			return {
				uploadPart: async (partNumber, value) => {
					const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
					state.parts.push({ partNumber, bytes });
					return { partNumber, etag: `etag-${partNumber}` };
				},
				complete: async (parts) => {
					state.completed = parts;
					state.size = state.parts.reduce((total, part) => total + part.bytes.length, 0);
					return { size: state.size };
				},
				abort: async () => {
					state.aborted = true;
				},
			};
		},
	};
	return { state, bucket };
}

test("a backup streams into one multipart upload and completes the record", async () => {
	const sqlite = database();
	addQueuedBackup(sqlite);
	const { state, bucket } = fakeBucket();
	await runDatabaseBackup({ DB: d1(sqlite), BUCKET: bucket }, "b1");

	assert.equal(state.aborted, false);
	assert.ok(state.completed?.length >= 1, "the upload never completed");
	assert.equal(state.options.customMetadata.backupId, "b1");
	assert.equal(state.options.httpMetadata.contentType, "application/json");
	assert.match(state.key, /^backups\/database\/b1\//);

	const document = JSON.parse(Buffer.concat(state.parts.map((part) => part.bytes)).toString("utf8"));
	assert.equal(document.format, "mailflare-database-backup");
	assert.ok(Array.isArray(document.tables.users));
	const [record] = sqlite.prepare("SELECT status, size, r2_key, filename, error FROM backups WHERE id = 'b1'").all();
	assert.equal(record.status, "completed");
	assert.equal(record.size, state.size);
	assert.equal(record.error, null);
	assert.equal(record.r2_key, state.key);
	assert.ok(record.filename);
});

test("a failing export aborts the multipart upload and marks the backup failed", async () => {
	const sqlite = database();
	addQueuedBackup(sqlite);
	const { state, bucket } = fakeBucket();
	await assert.rejects(
		runDatabaseBackup({ DB: d1(sqlite, { failPaged: "query exploded" }), BUCKET: bucket }, "b1"),
		/query exploded/,
	);
	assert.equal(state.aborted, true, "the upload was not aborted");
	const [record] = sqlite.prepare("SELECT status, error FROM backups WHERE id = 'b1'").all();
	assert.equal(record.status, "failed");
	assert.match(record.error, /query exploded/);
});

test("the part buffer uploads exactly when a part is full and flushes the remainder", async () => {
	const uploaded = [];
	const buffer = new BackupPartBuffer(10);
	await buffer.push(new Uint8Array([1, 2, 3, 4]), (part) => uploaded.push(part));
	await buffer.push(new Uint8Array([5, 6, 7]), (part) => uploaded.push(part));
	assert.deepEqual(uploaded, [], "nothing uploads below the part size");
	await buffer.push(new Uint8Array([8, 9, 10, 11, 12]), (part) => uploaded.push(part));
	assert.deepEqual(uploaded, [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])]);
	assert.deepEqual([...buffer.flush()], [], "an exact boundary leaves nothing to flush");

	const tail = new BackupPartBuffer(10);
	await tail.push(new Uint8Array([1, 2]), (part) => uploaded.push(part));
	assert.deepEqual([...tail.flush()], [1, 2], "the remainder flushes at the end");
});
