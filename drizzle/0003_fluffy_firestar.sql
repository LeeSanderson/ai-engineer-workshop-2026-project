CREATE TABLE `points_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`points` integer NOT NULL,
	`lesson_id` integer,
	`quiz_id` integer,
	`course_id` integer,
	`streak_date` text,
	`is_backfill` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `points_events_unique_source` ON `points_events` (
	`user_id`,
	`kind`,
	COALESCE(`lesson_id`, -1),
	COALESCE(`quiz_id`, -1),
	COALESCE(`course_id`, -1),
	COALESCE(`streak_date`, '')
);
--> statement-breakpoint
ALTER TABLE `users` ADD `timezone` text DEFAULT 'UTC' NOT NULL;