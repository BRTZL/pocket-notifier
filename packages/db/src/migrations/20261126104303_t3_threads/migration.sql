CREATE TABLE `t3_bridge` (
	`user_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	CONSTRAINT `t3_bridge_pk` PRIMARY KEY(`user_id`, `environment_id`),
	CONSTRAINT `fk_t3_bridge_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `feature` ADD `t3_environment_id` text;--> statement-breakpoint
ALTER TABLE `feature` ADD `t3_thread_id` text;--> statement-breakpoint
ALTER TABLE `feature` ADD `t3_title` text;--> statement-breakpoint
ALTER TABLE `feature` ADD `t3_phase` text;--> statement-breakpoint
ALTER TABLE `feature` ADD `t3_phase_at` integer;--> statement-breakpoint
ALTER TABLE `feature` ADD `t3_branch` text;--> statement-breakpoint
ALTER TABLE `feature` ADD `t3_pull_request_url` text;--> statement-breakpoint
ALTER TABLE `feature` ADD `t3_summary` text;--> statement-breakpoint
ALTER TABLE `feature` ADD `t3_run_started_at` integer;--> statement-breakpoint
ALTER TABLE `feature` ADD `t3_sequence` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `feature_projectId_t3Thread_uidx` ON `feature` (`project_id`,`t3_environment_id`,`t3_thread_id`) WHERE "feature"."t3_thread_id" is not null;