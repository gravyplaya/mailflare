-- Follow-up reminders moved from the fork-only shape (one row per reminder,
-- mailbox-scoped, statuses pending/replied/triggered/cancelled) to the shared
-- shape (one row per sent message, statuses pending/due/replied/dismissed).
-- No database has applied 0071 yet, so this file owns creation: existing
-- databases get their fork-shaped table rebuilt here, pending reminders are
-- transient by nature and are not preserved.
DROP TABLE IF EXISTS `follow_ups`;
--> statement-breakpoint
CREATE TABLE `follow_ups` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`due_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `follow_ups_message_idx` ON `follow_ups` (`message_id`);
--> statement-breakpoint
CREATE INDEX `follow_ups_status_due_idx` ON `follow_ups` (`status`,`due_at`);
--> statement-breakpoint
CREATE INDEX `follow_ups_user_status_idx` ON `follow_ups` (`user_id`,`status`);
