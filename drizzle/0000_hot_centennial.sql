CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`username` text NOT NULL,
	`title` text NOT NULL,
	`email` text,
	`thumb` text,
	`auth_token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `history` (
	`server_id` text NOT NULL,
	`history_key` text NOT NULL,
	`account_id` integer NOT NULL,
	`server_account_id` integer,
	`rating_key` text,
	`library_section_id` text,
	`type` text DEFAULT 'other' NOT NULL,
	`title` text DEFAULT 'Unknown' NOT NULL,
	`parent_title` text,
	`grandparent_title` text,
	`index` integer,
	`parent_index` integer,
	`year` integer,
	`thumb` text,
	`grandparent_thumb` text,
	`duration` integer,
	`originally_available_at` text,
	`viewed_at` integer NOT NULL,
	`device_id` integer,
	`synced_at` integer NOT NULL,
	PRIMARY KEY(`server_id`, `history_key`),
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`client_identifier`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `history_account_viewed_idx` ON `history` (`account_id`,`viewed_at`);--> statement-breakpoint
CREATE INDEX `history_viewed_idx` ON `history` (`viewed_at`);--> statement-breakpoint
CREATE INDEX `history_type_idx` ON `history` (`type`);--> statement-breakpoint
CREATE TABLE `servers` (
	`client_identifier` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`name` text NOT NULL,
	`product` text,
	`version` text,
	`owned` integer DEFAULT false NOT NULL,
	`access_token` text NOT NULL,
	`base_url` text,
	`connections` text,
	`server_account_id` integer,
	`last_synced_at` integer,
	`last_sync_error` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `servers_account_idx` ON `servers` (`account_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_account_idx` ON `sessions` (`account_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
