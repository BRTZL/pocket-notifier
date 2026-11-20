CREATE TABLE `access_token` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`hash` text NOT NULL UNIQUE,
	`start` text NOT NULL,
	`scope_json` text NOT NULL,
	`expires_at` integer,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_access_token_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT "access_token_hash_check" CHECK(length("hash") = 64 and "hash" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TABLE `device` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`push_token` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`app_version` text,
	`last_seen_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_device_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT "device_platform_check" CHECK("platform" in ('android', 'ios'))
);
--> statement-breakpoint
CREATE TABLE `invite` (
	`id` text PRIMARY KEY,
	`created_by` text NOT NULL,
	`code_hash` text NOT NULL UNIQUE,
	`email` text,
	`grants_json` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by` text,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_invite_created_by_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_invite_accepted_by_user_id_fk` FOREIGN KEY (`accepted_by`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `message` (
	`id` text PRIMARY KEY,
	`topic_id` text NOT NULL,
	`title` text,
	`body` text DEFAULT '' NOT NULL,
	`priority` integer NOT NULL,
	`tags_json` text NOT NULL,
	`click_url` text,
	`actions_json` text NOT NULL,
	`conversation_json` text,
	`sender_json` text,
	`published_by` text,
	`token_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT `fk_message_topic_id_topic_id_fk` FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_message_published_by_user_id_fk` FOREIGN KEY (`published_by`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_message_token_id_access_token_id_fk` FOREIGN KEY (`token_id`) REFERENCES `access_token`(`id`) ON DELETE SET NULL,
	CONSTRAINT "message_priority_check" CHECK("priority" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE `message_read` (
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`read_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `message_read_pk` PRIMARY KEY(`message_id`, `user_id`),
	CONSTRAINT `fk_message_read_message_id_message_id_fk` FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_message_read_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `message_response` (
	`id` text PRIMARY KEY,
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`action_key` text NOT NULL,
	`kind` text NOT NULL,
	`text` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_message_response_message_id_message_id_fk` FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_message_response_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT "message_response_kind_check" CHECK("kind" in ('ack', 'text'))
);
--> statement-breakpoint
CREATE TABLE `subscription` (
	`topic_id` text NOT NULL,
	`user_id` text NOT NULL,
	`muted` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `subscription_pk` PRIMARY KEY(`topic_id`, `user_id`),
	CONSTRAINT `fk_subscription_topic_id_topic_id_fk` FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_subscription_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `topic` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL UNIQUE,
	`display_name` text,
	`description` text,
	`default_priority` integer DEFAULT 3 NOT NULL,
	`retention_days` integer DEFAULT 30 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `topic_member` (
	`topic_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`added_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `topic_member_pk` PRIMARY KEY(`topic_id`, `user_id`),
	CONSTRAINT `fk_topic_member_topic_id_topic_id_fk` FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_topic_member_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT "topic_member_role_check" CHECK("role" in ('owner', 'publisher', 'subscriber'))
);
--> statement-breakpoint
CREATE INDEX `access_token_userId_idx` ON `access_token` (`user_id`);--> statement-breakpoint
CREATE INDEX `device_userId_idx` ON `device` (`user_id`);--> statement-breakpoint
CREATE INDEX `invite_createdBy_idx` ON `invite` (`created_by`);--> statement-breakpoint
CREATE INDEX `message_topicId_id_idx` ON `message` (`topic_id`,`id`);--> statement-breakpoint
CREATE INDEX `message_expiresAt_idx` ON `message` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_response_messageId_userId_actionKey_uidx` ON `message_response` (`message_id`,`user_id`,`action_key`);--> statement-breakpoint
CREATE INDEX `subscription_userId_idx` ON `subscription` (`user_id`);--> statement-breakpoint
CREATE INDEX `topic_member_userId_idx` ON `topic_member` (`user_id`);