ALTER TABLE `feature` ADD `t3_environment_id` text;--> statement-breakpoint
ALTER TABLE `feature` ADD `t3_thread_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `feature_projectId_t3Thread_uidx` ON `feature` (`project_id`,`t3_environment_id`,`t3_thread_id`) WHERE "feature"."t3_thread_id" is not null;