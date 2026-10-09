import { countDistinct, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { messages } from "@/db/schema";
import type { ConversationPage, ConversationPageInput, MessageListColumns } from "./types";

export function getMessageListColumns(): MessageListColumns {
	return Object.fromEntries(
		Object.entries(getTableColumns(messages)).filter(([name]) => name !== "textBody" && name !== "htmlBody"),
	) as MessageListColumns;
}

/**
 * Lower-cased bare address of a stored From header, computed in SQL so sender
 * bundles can partition and look up members on it. Mirrors
 * normalizeEmailAddress for the values intake stores (`"Name" <addr>` or a
 * bare address).
 */
export function getSenderKeySql() {
	return sql<string>`case when instr(${messages.fromAddr}, '<') > 0 and instr(${messages.fromAddr}, '>') > instr(${messages.fromAddr}, '<') then lower(substr(${messages.fromAddr}, instr(${messages.fromAddr}, '<') + 1, instr(${messages.fromAddr}, '>') - instr(${messages.fromAddr}, '<') - 1)) else lower(trim(${messages.fromAddr})) end`;
}

/** Select one newest matching message per conversation or sender before applying pagination. */
export async function loadConversationPage({ db, where, offset, limit, group = "thread" }: ConversationPageInput): Promise<ConversationPage> {
	const groupKey = group === "sender" ? getSenderKeySql() : sql<string>`coalesce(${messages.threadId}, ${messages.id})`;
	const ranked = db
		.select({
			id: messages.id,
			createdAt: messages.createdAt,
			position: sql<number>`row_number() over (partition by ${groupKey} order by ${messages.createdAt} desc, ${messages.id} desc)`.as("position"),
		})
		.from(messages)
		.where(where)
		.as("conversation_heads");

	// Always two queries, even for deep pages or threads with many messages.
	const [totals, heads] = await Promise.all([
		db.select({ total: countDistinct(groupKey) }).from(messages).where(where),
		db
			.select({ id: ranked.id })
			.from(ranked)
			.where(eq(ranked.position, 1))
			.orderBy(desc(ranked.createdAt), desc(ranked.id))
			.limit(limit)
			.offset(offset),
	]);

	return { ids: heads.map((head) => head.id), total: totals[0]?.total ?? 0 };
}
