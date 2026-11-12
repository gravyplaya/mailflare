import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { backups } from "@/db/schema";
import { streamDatabaseRecords } from "./export";
import { createScheduledBackupIfDue, getBackupSettings } from "./service";
import { BACKUP_PREFIX, createBackupFilename } from "./utils";

/** Every part except the last must meet R2's 5 MiB minimum, so bytes flush with margin to spare. */
const BACKUP_PART_BYTES = 8 * 1024 * 1024;

/**
 * Collects streamed chunks into fixed-size multipart-upload parts. Chunks
 * arrive far smaller than a part (a page of rows at a time), so they fill the
 * buffer until a part is complete. R2 requires every non-trailing part of an
 * upload to share one length (S3 and B2 are content), so each part is sliced
 * to exactly `partBytes` and only the trailing part may be short.
 */
export class BackupPartBuffer {
	private readonly buffer: Uint8Array;
	private filled = 0;

	constructor(private readonly partBytes = BACKUP_PART_BYTES) {
		this.buffer = new Uint8Array(partBytes);
	}

	/** Copies the chunk into the buffer, uploading a part each time one fills. */
	async push(chunk: Uint8Array, upload: (part: Uint8Array) => Promise<void>): Promise<void> {
		let offset = 0;
		while (offset < chunk.length) {
			const take = Math.min(this.partBytes - this.filled, chunk.length - offset);
			this.buffer.set(chunk.subarray(offset, offset + take), this.filled);
			this.filled += take;
			offset += take;
			if (this.filled === this.partBytes) {
				// Each upload is awaited before more bytes are copied, so handing
				// over the reused buffer is safe.
				await upload(this.buffer);
				this.filled = 0;
			}
		}
	}

	/** The trailing part: the one part allowed to be short, possibly empty. */
	flush(): Uint8Array {
		return this.buffer.subarray(0, this.filled);
	}
}

export async function runDatabaseBackup(env: CloudflareEnv, backupId: string): Promise<void> {
	const db = getDb(env);
	try {
		await db
			.update(backups)
			.set({ status: "running", startedAt: new Date() })
			.where(eq(backups.id, backupId));

		const settings = await getBackupSettings(env);
		const filename = createBackupFilename(new Date());
		const r2Key = `${BACKUP_PREFIX}/${backupId}/${filename}`;
		// The document streams straight into a multipart upload. No step holds
		// the whole backup in memory: past a few hundred megabytes a single
		// JSON string outgrew the engine's string limit, and a whole-document
		// buffer outgrows the isolate's heap long before that.
		const upload = await env.BUCKET.createMultipartUpload(r2Key, {
			httpMetadata: { contentType: "application/json" },
			customMetadata: { backupId },
		});
		const parts: R2UploadedPart[] = [];
		let partNumber = 1;
		const buffer = new BackupPartBuffer();
		const uploadPart = async (part: Uint8Array) => {
			parts.push(await upload.uploadPart(partNumber++, part));
		};
		try {
			await streamDatabaseRecords(env.DB, settings?.excludedTableGroups ?? [], async (chunk) => buffer.push(chunk, uploadPart));
			const tail = buffer.flush();
			if (tail.length) await uploadPart(tail);
			const object = await upload.complete(parts);
			await db
				.update(backups)
				.set({
					status: "completed",
					filename,
					r2Key,
					size: object.size,
					completedAt: new Date(),
					error: null,
				})
				.where(eq(backups.id, backupId));
		} catch (error) {
			// Unfinished multipart uploads keep their parts and are billed: tell
			// the bucket to drop them even when this abort itself fails, so the
			// original error is the one that surfaces.
			await upload.abort().catch(() => undefined);
			throw error;
		}
		await deleteExpiredBackups(env);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Backup failed";
		await db
			.update(backups)
			.set({ status: "failed", error: message, completedAt: new Date() })
			.where(eq(backups.id, backupId));
		throw error;
	}
}

export async function runScheduledDatabaseBackup(env: CloudflareEnv, now: Date): Promise<void> {
	const backupId = await createScheduledBackupIfDue(env, now);
	if (backupId) {
		await runDatabaseBackup(env, backupId);
		return;
	}
	await deleteExpiredBackups(env);
}

export async function deleteExpiredBackups(env: CloudflareEnv): Promise<number> {
	const settings = await getBackupSettings(env);
	if (!settings?.retentionEnabled) return 0;

	const cutoff = new Date(Date.now() - settings.retentionDays * 86_400_000);
	const db = getDb(env);
	const expired = await db
		.select()
		.from(backups)
		.where(
			and(
				lt(backups.createdAt, cutoff),
				inArray(backups.status, ["completed", "failed"]),
			),
		);
	for (const backup of expired) {
		if (backup.r2Key) await env.BUCKET.delete(backup.r2Key);
		await db.delete(backups).where(eq(backups.id, backup.id));
	}
	return expired.length;
}
