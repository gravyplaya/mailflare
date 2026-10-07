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
CREATE TABLE `follow_ups` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`mailbox_id` text NOT NULL REFERENCES `mailboxes`(`id`) ON DELETE cascade,
	`message_id` text NOT NULL REFERENCES `messages`(`id`) ON DELETE cascade,
	`due_at` integer NOT NULL,
	`status` text NOT NULL DEFAULT 'pending',
	`triggered_at` integer,
	`created_at` integer NOT NULL
);
CREATE INDEX `follow_ups_user_status_idx` ON `follow_ups` (`user_id`, `status`);
CREATE INDEX `follow_ups_message_idx` ON `follow_ups` (`message_id`);
