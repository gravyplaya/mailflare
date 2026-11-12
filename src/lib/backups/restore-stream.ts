import type { DatabaseBackupTable, DatabaseRecord } from "./types";

export type BackupStreamHeader = {
	format: string;
	version: 1 | 2;
	createdAt: string;
	includedTables?: DatabaseBackupTable[];
};

export interface BackupStreamHandlers {
	onHeader(header: BackupStreamHeader): Promise<void> | void;
	onTable(table: DatabaseBackupTable): Promise<void> | void;
	onRow(table: DatabaseBackupTable, row: DatabaseRecord): Promise<void> | void;
}

/** The header always ends with this key; everything before it is a self-contained object minus its closing brace. */
const TABLES_MARKER = '"tables":';

const isSpace = (ch: string) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
const describe = (ch: string | undefined) => (ch === undefined ? "the end of the file" : JSON.stringify(ch));

/**
 * Reads a backup document incrementally and hands its pieces to `handlers`:
 * the header object once, then each table and each of its records as they
 * complete. The scanner is string-aware, so braces and quotes inside record
 * values never confuse it, and it holds no more than the current record —
 * a backup far larger than memory restores the same as a small one.
 *
 * The document must be whole: a stream that ends before the final brace is an
 * error, not a partial restore.
 */
export async function scanBackupStream(stream: ReadableStream<Uint8Array>, handlers: BackupStreamHandlers): Promise<void> {
	const decoder = new TextDecoder();
	let pending = "";
	let pos = 0;
	let done = false;
	let state: "header" | "tables-open" | "tables" | "rows" | "between" | "closing" = "header";
	let table: DatabaseBackupTable | null = null;
	// Scanner state for record bodies, carried across chunk boundaries.
	let depth = 0;
	let inString = false;
	let escaped = false;
	let rowStart = -1;

	const fail = (why: string): never => {
		throw new Error(`The backup file is not a valid Mailflare backup (${why})`);
	};

	/** Parses JSON or fails with the scanner's error; lets callers assign directly. */
	const parseJsonOr = <T>(text: string, why: string): T => {
		try {
			return JSON.parse(text) as T;
		} catch {
			return fail(why);
		}
	};

	/** Completes the next structural unit; false means the stream must supply more. */
	async function step(): Promise<boolean> {
		switch (state) {
			case "header": {
				const marker = pending.indexOf(TABLES_MARKER, pos);
				if (marker === -1) {
					if (pending.length > 1024 * 1024) fail("the document never reaches its tables");
					return false;
				}
				const header = parseJsonOr<BackupStreamHeader>(`${pending.slice(0, marker).replace(/,$/, "")}}`, "the document header is malformed");
				if (header.format !== "mailflare-database-backup" || (header.version !== 1 && header.version !== 2) || typeof header.createdAt !== "string") {
					fail("unknown format");
				}
				pos = marker + TABLES_MARKER.length;
				await handlers.onHeader(header);
				state = "tables-open";
				return true;
			}
			case "tables-open": {
				while (pos < pending.length && isSpace(pending[pos])) pos++;
				if (pos >= pending.length) return false;
				if (pending[pos] !== "{") fail(`${describe(pending[pos])} where the tables should open`);
				pos++;
				state = "tables";
				return true;
			}
			case "tables": {
				while (pos < pending.length && isSpace(pending[pos])) pos++;
				if (pos >= pending.length) return false;
				if (pending[pos] === "}") {
					pos++;
					state = "closing";
					return true;
				}
				if (pending[pos] !== '"') fail(`${describe(pending[pos])} where a table name was expected`);
				const closeQuote = pending.indexOf('"', pos + 1);
				if (closeQuote === -1) return false;
				const name = pending.slice(pos + 1, closeQuote);
				if (pending.startsWith(":[", closeQuote + 1)) {
					table = name as DatabaseBackupTable;
					pos = closeQuote + 3;
					await handlers.onTable(table);
					state = "rows";
					return true;
				}
				if (pending.length < closeQuote + 3) return false;
				fail(`the ${name} table entry is malformed`);
			}
			case "rows": {
				for (; pos < pending.length; pos++) {
					const ch = pending[pos];
					if (inString) {
						if (escaped) escaped = false;
						else if (ch === "\\") escaped = true;
						else if (ch === '"') inString = false;
						continue;
					}
					if (ch === '"') {
						inString = true;
						continue;
					}
					if (ch === "{") {
						depth++;
						if (depth === 1) rowStart = pos;
						continue;
					}
					if (ch === "}") {
						depth--;
						if (depth === 0) {
							const row = parseJsonOr<DatabaseRecord>(pending.slice(rowStart, pos + 1), "a record is not valid JSON");
							await handlers.onRow(table as DatabaseBackupTable, row);
							rowStart = -1;
							continue;
						}
						if (depth < 0) fail("unbalanced records");
						continue;
					}
					if (depth === 0) {
						if (ch === "]") {
							pos++;
							state = "between";
							return true;
						}
						if (ch === "," || isSpace(ch)) continue;
						fail(`${describe(ch)} inside a table`);
					}
				}
				return false;
			}
			case "between": {
				while (pos < pending.length && isSpace(pending[pos])) pos++;
				if (pos >= pending.length) return false;
				if (pending[pos] === ",") {
					pos++;
					state = "tables";
					return true;
				}
				if (pending[pos] === "}") {
					pos++;
					state = "closing";
					return true;
				}
				fail(`${describe(pending[pos])} after a table`);
			}
			case "closing": {
				while (pos < pending.length && isSpace(pending[pos])) pos++;
				if (pos >= pending.length) return false;
				if (pending[pos] !== "}") fail("the document does not close correctly");
				pos++;
				done = true;
				return true;
			}
		}
	}

	async function drain(final: boolean): Promise<void> {
		while (!done && (await step()));
		// Drop everything consumed, keeping the record under construction (its
		// start index rebases onto the shortened buffer).
		const keep = rowStart >= 0 ? rowStart : Math.min(pos, pending.length);
		if (keep > 0) {
			if (rowStart >= 0) rowStart -= keep;
			pos -= keep;
			pending = pending.slice(keep);
		}
		if (!final) return;
		if (!done) fail("the document ends unexpectedly");
		while (pos < pending.length && isSpace(pending[pos])) pos++;
		if (pos < pending.length) fail("unexpected content after the document");
	}

	const reader = stream.getReader();
	for (;;) {
		const { done: streamDone, value } = await reader.read();
		if (streamDone) break;
		pending += decoder.decode(value, { stream: true });
		await drain(false);
	}
	pending += decoder.decode();
	await drain(true);
}
