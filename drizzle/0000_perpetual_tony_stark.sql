CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`route_id` text NOT NULL,
	`track_id` text,
	`filename` text NOT NULL,
	`caption` text,
	`taken_at` integer,
	`lat` real,
	`lon` real,
	`distance_along_m` real,
	`width` integer,
	`height` integer,
	`order_index` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `photos_route_idx` ON `photos` (`route_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `routes` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`visibility` text DEFAULT 'unlisted' NOT NULL,
	`activity_type` text,
	`bbox` text,
	`started_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`distance_m` real DEFAULT 0 NOT NULL,
	`elevation_gain_m` real DEFAULT 0 NOT NULL,
	`elevation_loss_m` real DEFAULT 0 NOT NULL,
	`elevation_min_m` real,
	`elevation_max_m` real,
	`duration_s` integer,
	`moving_time_s` integer,
	`avg_speed_mps` real,
	`max_speed_mps` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routes_slug_unique` ON `routes` (`slug`);--> statement-breakpoint
CREATE INDEX `routes_visibility_started_idx` ON `routes` (`visibility`,`started_at`);--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`route_id` text NOT NULL,
	`name` text,
	`source_filename` text NOT NULL,
	`color` text NOT NULL,
	`order_index` integer DEFAULT 0 NOT NULL,
	`geometry` text NOT NULL,
	`elevations` text,
	`distances` text NOT NULL,
	`time_offsets` text,
	`point_count_original` integer NOT NULL,
	`point_count_stored` integer NOT NULL,
	`bbox` text,
	`started_at` integer,
	`distance_m` real DEFAULT 0 NOT NULL,
	`elevation_gain_m` real DEFAULT 0 NOT NULL,
	`elevation_loss_m` real DEFAULT 0 NOT NULL,
	`elevation_min_m` real,
	`elevation_max_m` real,
	`duration_s` integer,
	`moving_time_s` integer,
	`avg_speed_mps` real,
	`max_speed_mps` real,
	FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tracks_route_idx` ON `tracks` (`route_id`,`order_index`);