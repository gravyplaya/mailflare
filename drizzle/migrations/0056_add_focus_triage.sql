ALTER TABLE `users` ADD COLUMN `gatekeeper_enabled` integer NOT NULL DEFAULT 0;
ALTER TABLE `contacts` ADD COLUMN `priority` integer NOT NULL DEFAULT 0;
ALTER TABLE `contacts` ADD COLUMN `approved` integer NOT NULL DEFAULT 0;
ALTER TABLE `messages` ADD COLUMN `done` integer NOT NULL DEFAULT 0;
CREATE TABLE `muted_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`mailbox_id` text NOT NULL REFERENCES `mailboxes`(`id`) ON DELETE cascade,
	`thread_id` text NOT NULL,
	`auto_archive` integer NOT NULL DEFAULT 0,
	`created_at` integer NOT NULL
);
CREATE UNIQUE INDEX `muted_threads_mailbox_thread_idx` ON `muted_threads` (`mailbox_id`, `thread_id`);
CREATE INDEX `muted_threads_user_idx` ON `muted_threads` (`user_id`);
-- follow_ups is created by 0084_add_follow_ups.sql, which also reshapes the
-- table on databases that applied the earlier fork-only version of this file.
