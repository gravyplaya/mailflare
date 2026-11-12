CREATE TABLE "linked_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"provider" text DEFAULT 'gmail' NOT NULL,
	"connected_account_id" text NOT NULL,
	"email_address" text,
	"destination" text DEFAULT 'system:inbox' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sync_cursor" text,
	"last_synced_at" bigint,
	"last_error" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linked_calendars" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"connected_account_id" text NOT NULL,
	"calendar_id" text DEFAULT 'primary' NOT NULL,
	"calendar_summary" text,
	"sync_token" text,
	"last_synced_at" bigint,
	"last_error" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "muted_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"auto_archive" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "key_sha256" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "source" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "source_label" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "ical_uid" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "priority" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "has_unsubscribe" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "calendar_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "drive_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_spam_protection_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gatekeeper_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "linked_accounts" ADD CONSTRAINT "linked_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_accounts" ADD CONSTRAINT "linked_accounts_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_calendars" ADD CONSTRAINT "linked_calendars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muted_threads" ADD CONSTRAINT "muted_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muted_threads" ADD CONSTRAINT "muted_threads_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "linked_accounts_provider_account_idx" ON "linked_accounts" USING btree ("provider","connected_account_id");--> statement-breakpoint
CREATE INDEX "linked_accounts_user_idx" ON "linked_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "linked_accounts_mailbox_idx" ON "linked_accounts" USING btree ("mailbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "linked_calendars_account_calendar_idx" ON "linked_calendars" USING btree ("connected_account_id","calendar_id");--> statement-breakpoint
CREATE UNIQUE INDEX "muted_threads_mailbox_thread_idx" ON "muted_threads" USING btree ("mailbox_id","thread_id");--> statement-breakpoint
CREATE INDEX "muted_threads_user_idx" ON "muted_threads" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_sha256_idx" ON "api_keys" USING btree ("key_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_external_ref_idx" ON "calendar_events" USING btree ("external_ref");