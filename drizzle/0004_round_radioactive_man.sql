CREATE TABLE `dismissed_streak_banners` (
	`user_id` integer NOT NULL,
	`last_active_date` text NOT NULL,
	`dismissed_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `last_active_date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
