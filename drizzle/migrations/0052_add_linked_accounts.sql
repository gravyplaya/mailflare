CREATE TABLE `linked_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`provider` text DEFAULT 'gmail' NOT NULL,
	`connected_account_id` text NOT NULL,
	`email_address` text,
	`destination` text DEFAULT 'system:inbox' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_synced_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `linked_accounts_provider_account_idx` ON `linked_accounts` (`provider`,`connected_account_id`);
--> statement-breakpoint
CREATE INDEX `linked_accounts_user_idx` ON `linked_accounts` (`user_id`);
--> statement-breakpoint
CREATE INDEX `linked_accounts_mailbox_idx` ON `linked_accounts` (`mailbox_id`);
