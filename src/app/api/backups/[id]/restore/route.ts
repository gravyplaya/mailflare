import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { backups } from "@/db/schema";
import { assertPrimaryAdmin } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/cookies";
import { restoreDatabaseBackupStream } from "@/lib/backups/export";
import { getEnv } from "@/lib/cloudflare";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const env = getEnv();
	try {
		const user = await requireUser(env, request);
		assertPrimaryAdmin(user);
		const { id } = await params;
		const [backup] = await getDb(env).select().from(backups).where(eq(backups.id, id)).limit(1);
		if (!backup?.r2Key || backup.status !== "completed") return NextResponse.json({ error: "Backup file not found" }, { status: 404 });
		// The document streams straight from storage: the validate pass and the
		// insert pass each open it fresh, so no request ever holds the whole
		// backup and no re-upload is needed.
		await restoreDatabaseBackupStream(env.DB, async () => {
			const object = await env.BUCKET.get(backup.r2Key as string);
			if (!object) throw new Error("Backup file not found");
			return object.body;
		});
		return NextResponse.json({ ok: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to restore backup";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
