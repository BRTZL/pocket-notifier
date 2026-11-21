CREATE TABLE `attachment` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`message_id` text,
	`uploaded_by` text,
	`token_id` text,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`r2_key` text NOT NULL,
	`download_token` text NOT NULL,
	`upload_token_hash` text,
	`upload_expires_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT `fk_attachment_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_attachment_message_id_message_id_fk` FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_attachment_uploaded_by_user_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_attachment_token_id_access_token_id_fk` FOREIGN KEY (`token_id`) REFERENCES `access_token`(`id`) ON DELETE SET NULL,
	CONSTRAINT "attachment_status_check" CHECK("status" in ('pending', 'uploaded'))
);
--> statement-breakpoint
ALTER TABLE `project` ADD `icon_url` text;--> statement-breakpoint
CREATE UNIQUE INDEX `attachment_messageId_uidx` ON `attachment` (`message_id`);--> statement-breakpoint
CREATE INDEX `attachment_expiresAt_idx` ON `attachment` (`expires_at`);--> statement-breakpoint
CREATE INDEX `attachment_projectId_idx` ON `attachment` (`project_id`);