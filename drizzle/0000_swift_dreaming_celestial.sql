CREATE TABLE `idempotency_keys` (
	`request_key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload_hash` text NOT NULL,
	`run_id` text NOT NULL,
	`steering_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`steering_id`) REFERENCES `steering_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`owner_key` text NOT NULL,
	`output_json` text,
	`error_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runs_status_created_idx` ON `runs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `runs_owner_status_idx` ON `runs` (`owner_key`,`status`);--> statement-breakpoint
CREATE INDEX `runs_updated_idx` ON `runs` (`updated_at`);--> statement-breakpoint
CREATE TABLE `steering_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`instruction` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `steering_run_revision_idx` ON `steering_events` (`run_id`,`revision`);