import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import Database from "better-sqlite3";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mailflare-focus-triage-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

async function bundle(entry, outfile) {
	await build({
		entryPoints: [join(root, entry)],
		outfile: join(outDir, outfile),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		logLevel: "silent",
		alias: { "@": join(root, "src") },
		external: ["react", "react-dom", "next", "next/*"],
	});
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const counts = await bundle("src/app/api/messages/counts/utils.ts", "counts.mjs");
const bulk = await bundle("src/app/api/messages/bulk/utils.ts", "bulk.mjs");

test("gatekeeper-held mail counts under the gatekeeper folder", () => {
	assert.equal(counts.getMessageFolder({ status: "pending", direction: "inbound", read: false, snoozedUntil: null, done: false }), "gatekeeper");
});

test("a done message still counts as archived and appears in the done view", () => {
	const row = { status: "archived", direction: "inbound", read: false, starred: false, folderId: null, mailboxId: "m", snoozedUntil: null, done: true, total: 1 };
	const built = counts.buildMessageCounts([row]);
	assert.equal(built.folders.archived.total, 1);
	assert.equal(built.folders.done.total, 1);
	assert.equal(built.folders.done.unread, 1);
});

test("undone archived mail is not part of the done view", () => {
	const row = { status: "archived", direction: "inbound", read: false, starred: false, folderId: null, mailboxId: "m", snoozedUntil: null, done: false, total: 1 };
	const built = counts.buildMessageCounts([row]);
	assert.equal(built.folders.archived.total, 1);
	assert.equal(built.folders.done.total, 0);
});

test("empty folder counts include gatekeeper and done", () => {
	const empty = counts.createEmptyFolderCounts();
	assert.deepEqual(empty.gatekeeper, { total: 0, unread: 0 });
	assert.deepEqual(empty.done, { total: 0, unread: 0 });
});

test("bulk done action archives, inbox clears the done flag", () => {
	assert.ok(bulk.isAllowedBulkMessageAction("done"));
	assert.equal(bulk.getStatusForBulkAction("done"), "archived");
	assert.equal(bulk.getStatusForBulkAction("inbox"), "received");
});

test("migration adds focus triage columns and tables with the right defaults", () => {
	const db = new Database(":memory:");
	db.exec("CREATE TABLE users (id text primary key)");
	db.exec("CREATE TABLE contacts (id text primary key, user_id text, email text, blocked integer default 0)");
	db.exec("CREATE TABLE mailboxes (id text primary key, user_id text, domain_id text)");
	db.exec("CREATE TABLE messages (id text primary key, user_id text, mailbox_id text, thread_id text)");
	db.exec(readFileSync(join(root, "drizzle/migrations/0056_add_focus_triage.sql"), "utf8"));

	db.exec("INSERT INTO users (id) VALUES ('u')");
	assert.equal(db.prepare("SELECT gatekeeper_enabled AS value FROM users").get().value, 0);
	db.exec("INSERT INTO contacts (id, user_id, email) VALUES ('c', 'u', 'a@b.c')");
	assert.deepEqual(db.prepare("SELECT priority, approved FROM contacts").get(), { priority: 0, approved: 0 });
	db.exec("INSERT INTO messages (id, user_id, mailbox_id) VALUES ('msg', 'u', 'm')");
	assert.equal(db.prepare("SELECT done FROM messages").get().done, 0);

	db.exec("INSERT INTO mailboxes (id, user_id, domain_id) VALUES ('m', 'u', 'd')");
	db.exec("INSERT INTO muted_threads (id, user_id, mailbox_id, thread_id, created_at) VALUES ('mut', 'u', 'm', 'thr', 1)");
	assert.equal(db.prepare("SELECT auto_archive FROM muted_threads").get().auto_archive, 0);
	db.exec("INSERT INTO follow_ups (id, user_id, mailbox_id, message_id, due_at, created_at) VALUES ('f', 'u', 'm', 'msg', 123, 1)");
	assert.equal(db.prepare("SELECT status FROM follow_ups").get().status, "pending");
});
