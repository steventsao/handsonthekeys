CREATE TABLE `relay_events` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`revision` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text,
	`message` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `relay_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `relay_participants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relay_events_room_revision_unique` ON `relay_events` (`room_id`,`revision`);--> statement-breakpoint
CREATE INDEX `relay_events_room_created_idx` ON `relay_events` (`room_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `relay_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`role` text NOT NULL,
	`capability` text NOT NULL,
	`input_interface` text NOT NULL,
	`output_interface` text NOT NULL,
	`joined_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `relay_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relay_participants_token_hash_unique` ON `relay_participants` (`token_hash`);--> statement-breakpoint
CREATE INDEX `relay_participants_room_joined_idx` ON `relay_participants` (`room_id`,`joined_at`);--> statement-breakpoint
CREATE TABLE `relay_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`goal` text NOT NULL,
	`phase` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `relay_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`brief` text NOT NULL,
	`capability` text NOT NULL,
	`status` text NOT NULL,
	`suggested_participant_id` text,
	`suggestion_reason` text NOT NULL,
	`claimed_by_participant_id` text,
	`output_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `relay_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`suggested_participant_id`) REFERENCES `relay_participants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`claimed_by_participant_id`) REFERENCES `relay_participants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relay_tasks_room_position_unique` ON `relay_tasks` (`room_id`,`position`);--> statement-breakpoint
CREATE INDEX `relay_tasks_room_status_idx` ON `relay_tasks` (`room_id`,`status`);