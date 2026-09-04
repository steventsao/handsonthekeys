CREATE TABLE `studio_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_shares_request_id_unique` ON `studio_shares` (`request_id`);--> statement-breakpoint
CREATE INDEX `studio_shares_expires_idx` ON `studio_shares` (`expires_at`);