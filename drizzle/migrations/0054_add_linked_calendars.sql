CREATE TABLE `linked_calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connected_account_id` text NOT NULL,
	`calendar_id` text DEFAULT 'primary' NOT NULL,
	`calendar_summary` text,
	`sync_token` text,
	`last_synced_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `linked_calendars_account_calendar_idx` ON `linked_calendars` (`connected_account_id`,`calendar_id`);
--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `source` text DEFAULT 'local' NOT NULL;
--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `external_ref` text;
--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `ical_uid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_events_external_ref_idx` ON `calendar_events` (`external_ref`);
