CREATE TABLE `linked_accounts` (
	`id` varchar(191) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`mailbox_id` varchar(191) NOT NULL,
	`provider` varchar(64) NOT NULL DEFAULT 'gmail',
	`connected_account_id` varchar(191) NOT NULL,
	`email_address` longtext,
	`destination` longtext NOT NULL DEFAULT ('system:inbox'),
	`enabled` boolean NOT NULL DEFAULT true,
	`sync_cursor` longtext,
	`last_synced_at` bigint,
	`last_error` longtext,
	`created_at` bigint NOT NULL,
	CONSTRAINT `linked_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `linked_accounts_provider_account_idx` UNIQUE(`provider`,`connected_account_id`)
);
--> statement-breakpoint
CREATE TABLE `linked_calendars` (
	`id` varchar(191) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`connected_account_id` varchar(191) NOT NULL,
	`calendar_id` varchar(191) NOT NULL DEFAULT 'primary',
	`calendar_summary` longtext,
	`sync_token` longtext,
	`last_synced_at` bigint,
	`last_error` longtext,
	`created_at` bigint NOT NULL,
	CONSTRAINT `linked_calendars_id` PRIMARY KEY(`id`),
	CONSTRAINT `linked_calendars_account_calendar_idx` UNIQUE(`connected_account_id`,`calendar_id`)
);
--> statement-breakpoint
CREATE TABLE `muted_threads` (
	`id` varchar(191) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`mailbox_id` varchar(191) NOT NULL,
	`thread_id` varchar(512) NOT NULL,
	`auto_archive` boolean NOT NULL DEFAULT false,
	`created_at` bigint NOT NULL,
	CONSTRAINT `muted_threads_id` PRIMARY KEY(`id`),
	CONSTRAINT `muted_threads_mailbox_thread_idx` UNIQUE(`mailbox_id`,`thread_id`)
);
--> statement-breakpoint
ALTER TABLE `api_keys` ADD `key_sha256` varchar(191);--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `source` longtext DEFAULT ('local') NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `external_ref` varchar(191);--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `source_label` longtext;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `ical_uid` longtext;--> statement-breakpoint
ALTER TABLE `contacts` ADD `priority` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `approved` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `done` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `has_unsubscribe` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `calendar_enabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `drive_enabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `ai_spam_protection_enabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `gatekeeper_enabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_key_sha256_idx` UNIQUE(`key_sha256`);--> statement-breakpoint
ALTER TABLE `calendar_events` ADD CONSTRAINT `calendar_events_external_ref_idx` UNIQUE(`external_ref`);--> statement-breakpoint
ALTER TABLE `linked_accounts` ADD CONSTRAINT `linked_accounts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `linked_accounts` ADD CONSTRAINT `linked_accounts_mailbox_id_mailboxes_id_fk` FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `linked_calendars` ADD CONSTRAINT `linked_calendars_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `muted_threads` ADD CONSTRAINT `muted_threads_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `muted_threads` ADD CONSTRAINT `muted_threads_mailbox_id_mailboxes_id_fk` FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `linked_accounts_user_idx` ON `linked_accounts` (`user_id`);--> statement-breakpoint
CREATE INDEX `linked_accounts_mailbox_idx` ON `linked_accounts` (`mailbox_id`);--> statement-breakpoint
CREATE INDEX `muted_threads_user_idx` ON `muted_threads` (`user_id`);