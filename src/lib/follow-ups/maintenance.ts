import { and, eq, gt, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { followUps, messages } from "@/db/schema";
import { notifyUsersOfNewMessage } from "@/lib/realtime/utils";

/**
 * Checks pending follow-up reminders: cancels ones whose message failed,
 * marks replied ones done when a reply landed in the thread, and triggers
 * the rest. Runs from the Worker scheduled handler.
 */
export async function runFollowUpMaintenance(env: CloudflareEnv): Promise<void> {
	const db = getDb(env);
	const now = new Date();
	const due = await db
		.select()
		.from(followUps)
		.where(and(eq(followUps.status, "pending"), lte(followUps.dueAt, now)))
		.limit(100);

	for (const item of due) {
		const [message] = await db
			.select({
				id: messages.id,
				mailboxId: messages.mailboxId,
				threadId: messages.threadId,
				subject: messages.subject,
				status: messages.status,
			})
			.from(messages)
			.where(eq(messages.id, item.messageId))
			.limit(1);

		if (!message || message.status === "failed" || message.status === "trash") {
			await db.update(followUps).set({ status: "cancelled" }).where(eq(followUps.id, item.id));
			continue;
		}

		// Sends that have not gone out yet stay pending.
		if (message.status !== "sent") continue;

		if (message.threadId && message.mailboxId) {
			const [reply] = await db
				.select({ id: messages.id })
				.from(messages)
				.where(
					and(
						eq(messages.mailboxId, message.mailboxId),
						eq(messages.threadId, message.threadId),
						eq(messages.direction, "inbound"),
						gt(messages.createdAt, item.createdAt),
					),
				)
				.limit(1);
			if (reply) {
				await db.update(followUps).set({ status: "replied" }).where(eq(followUps.id, item.id));
				continue;
			}
		}

		await db
			.update(followUps)
			.set({ status: "triggered", triggeredAt: now })
			.where(eq(followUps.id, item.id));
		try {
			await notifyUsersOfNewMessage(env, [item.userId], {
				type: "follow_up_due",
				messageId: message.id,
				mailboxId: item.mailboxId,
				subject: message.subject ?? null,
			});
		} catch (error) {
			console.error(`Follow-up notification failed for ${item.id}`, error);
		}
	}
}
