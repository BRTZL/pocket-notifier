-- Topics become projects: `topic` is now `project`, `topic_member` is `project_member`,
-- every `topic_id` column is `project_id`, ids change from `top_<x>` to `prj_<x>`, and
-- conversation keys from `t:top_<x>` to `p:prj_<x>`.
--
-- Hand-written; drizzle-kit would rebuild through DROP TABLE on tables that still have
-- children. Each affected table is rebuilt instead, so the constraint names that mention
-- topic go too, and ids are rewritten while copying (no primary key is ever updated).
-- Old tables are dropped only once nothing references them: on D1 foreign keys are
-- always on, and dropping a parent would cascade-delete its children's rows.
PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL UNIQUE,
	`display_name` text,
	`description` text,
	`default_priority` integer DEFAULT 3 NOT NULL,
	`retention_days` integer DEFAULT 30 NOT NULL,
	`personal_user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_project_personal_user_id_user_id_fk` FOREIGN KEY (`personal_user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `project` (`id`, `name`, `display_name`, `description`, `default_priority`, `retention_days`, `personal_user_id`, `created_at`, `updated_at`)
SELECT 'prj_' || substr(`id`, 5), `name`, `display_name`, `description`, `default_priority`, `retention_days`, `personal_user_id`, `created_at`, `updated_at`
FROM `topic`;
--> statement-breakpoint
CREATE TABLE `project_member` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`added_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `project_member_pk` PRIMARY KEY(`project_id`, `user_id`),
	CONSTRAINT `fk_project_member_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_member_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT "project_member_role_check" CHECK("role" in ('owner', 'publisher', 'subscriber'))
);
--> statement-breakpoint
INSERT INTO `project_member` (`project_id`, `user_id`, `role`, `added_at`)
SELECT 'prj_' || substr(`topic_id`, 5), `user_id`, `role`, `added_at`
FROM `topic_member`;
--> statement-breakpoint
CREATE TABLE `subscription_new` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`muted` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `subscription_pk` PRIMARY KEY(`project_id`, `user_id`),
	CONSTRAINT `fk_subscription_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_subscription_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `subscription_new` (`project_id`, `user_id`, `muted`, `created_at`)
SELECT 'prj_' || substr(`topic_id`, 5), `user_id`, `muted`, `created_at`
FROM `subscription`;
--> statement-breakpoint
CREATE TABLE `feature_new` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_message_at` integer,
	CONSTRAINT `fk_feature_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_feature_created_by_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "feature_status_check" CHECK("status" in ('active', 'done', 'archived')),
	CONSTRAINT "feature_slug_check" CHECK(length("slug") between 1 and 63 and "slug" not glob '*[^a-z0-9-]*' and substr("slug", 1, 1) <> '-')
);
--> statement-breakpoint
INSERT INTO `feature_new` (`id`, `project_id`, `slug`, `name`, `description`, `status`, `created_by`, `created_at`, `updated_at`, `last_message_at`)
SELECT `id`, 'prj_' || substr(`topic_id`, 5), `slug`, `name`, `description`, `status`, `created_by`, `created_at`, `updated_at`, `last_message_at`
FROM `feature`;
--> statement-breakpoint
CREATE TABLE `message_new` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`title` text,
	`body` text DEFAULT '' NOT NULL,
	`priority` integer NOT NULL,
	`tags_json` text NOT NULL,
	`click_url` text,
	`actions_json` text NOT NULL,
	`conversation_json` text,
	`sender_json` text,
	`conversation_key` text DEFAULT '' NOT NULL,
	`published_by` text,
	`token_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT `fk_message_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_message_published_by_user_id_fk` FOREIGN KEY (`published_by`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_message_token_id_access_token_id_fk` FOREIGN KEY (`token_id`) REFERENCES `access_token`(`id`) ON DELETE SET NULL,
	CONSTRAINT "message_priority_check" CHECK("priority" in (1, 2, 3, 4, 5))
);
--> statement-breakpoint
-- `t:top_<x>` keys become `p:prj_<x>`; `c:` keys are conversation ids and stay.
INSERT INTO `message_new` (`id`, `project_id`, `title`, `body`, `priority`, `tags_json`, `click_url`, `actions_json`, `conversation_json`, `sender_json`, `conversation_key`, `published_by`, `token_id`, `created_at`, `expires_at`)
SELECT `id`, 'prj_' || substr(`topic_id`, 5), `title`, `body`, `priority`, `tags_json`, `click_url`, `actions_json`, `conversation_json`, `sender_json`,
	CASE WHEN `conversation_key` LIKE 't:%' THEN 'p:prj_' || substr(`topic_id`, 5) ELSE `conversation_key` END,
	`published_by`, `token_id`, `created_at`, `expires_at`
FROM `message`;
--> statement-breakpoint
CREATE TABLE `message_read_new` (
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`read_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `message_read_pk` PRIMARY KEY(`message_id`, `user_id`),
	CONSTRAINT `fk_message_read_message_id_message_id_fk` FOREIGN KEY (`message_id`) REFERENCES `message_new`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_message_read_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `message_read_new` (`message_id`, `user_id`, `read_at`)
SELECT `message_id`, `user_id`, `read_at` FROM `message_read`;
--> statement-breakpoint
CREATE TABLE `message_response_new` (
	`id` text PRIMARY KEY,
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`action_key` text NOT NULL,
	`kind` text NOT NULL,
	`text` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_message_response_message_id_message_id_fk` FOREIGN KEY (`message_id`) REFERENCES `message_new`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_message_response_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT "message_response_kind_check" CHECK("kind" in ('ack', 'text'))
);
--> statement-breakpoint
INSERT INTO `message_response_new` (`id`, `message_id`, `user_id`, `action_key`, `kind`, `text`, `created_at`)
SELECT `id`, `message_id`, `user_id`, `action_key`, `kind`, `text`, `created_at` FROM `message_response`;
--> statement-breakpoint
-- Leaves first: by the time a parent is dropped, no table references it any more.
DROP TRIGGER `message_conversation_key_default`;
--> statement-breakpoint
DROP TABLE `message_read`;
--> statement-breakpoint
DROP TABLE `message_response`;
--> statement-breakpoint
DROP TABLE `message`;
--> statement-breakpoint
DROP TABLE `feature`;
--> statement-breakpoint
DROP TABLE `subscription`;
--> statement-breakpoint
DROP TABLE `topic_member`;
--> statement-breakpoint
DROP TABLE `topic`;
--> statement-breakpoint
-- Renaming a table also rewrites the REFERENCES clauses that point at it.
ALTER TABLE `message_new` RENAME TO `message`;
--> statement-breakpoint
ALTER TABLE `message_read_new` RENAME TO `message_read`;
--> statement-breakpoint
ALTER TABLE `message_response_new` RENAME TO `message_response`;
--> statement-breakpoint
ALTER TABLE `feature_new` RENAME TO `feature`;
--> statement-breakpoint
ALTER TABLE `subscription_new` RENAME TO `subscription`;
--> statement-breakpoint
CREATE UNIQUE INDEX `project_personalUserId_uidx` ON `project` (`personal_user_id`);
--> statement-breakpoint
CREATE INDEX `project_member_userId_idx` ON `project_member` (`user_id`);
--> statement-breakpoint
CREATE INDEX `subscription_userId_idx` ON `subscription` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `feature_projectId_slug_uidx` ON `feature` (`project_id`,`slug`);
--> statement-breakpoint
CREATE INDEX `message_projectId_id_idx` ON `message` (`project_id`,`id`);
--> statement-breakpoint
CREATE INDEX `message_projectId_conversationKey_id_idx` ON `message` (`project_id`,`conversation_key`,`id`);
--> statement-breakpoint
CREATE INDEX `message_expiresAt_idx` ON `message` (`expires_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_response_messageId_userId_actionKey_uidx` ON `message_response` (`message_id`,`user_id`,`action_key`);
--> statement-breakpoint
-- An insert that leaves conversation_key out gets the derived key instead of `''`.
CREATE TRIGGER `message_conversation_key_default`
AFTER INSERT ON `message`
FOR EACH ROW WHEN NEW.`conversation_key` = ''
BEGIN
	UPDATE `message` SET `conversation_key` = CASE
		WHEN json_extract(NEW.`conversation_json`, '$.id') IS NOT NULL
			THEN 'c:' || json_extract(NEW.`conversation_json`, '$.id')
		ELSE 'p:' || NEW.`project_id`
	END
	WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
-- Invite grants name projects by id: [{"topicId":"top_<x>","role":…}] becomes
-- [{"projectId":"prj_<x>","role":…}], in the same order.
UPDATE `invite` SET `grants_json` = (
	SELECT json_group_array(json_object(
		'projectId', 'prj_' || substr(json_extract(`grant`.`value`, '$.topicId'), 5),
		'role', json_extract(`grant`.`value`, '$.role')
	))
	FROM json_each(`invite`.`grants_json`) AS `grant`
)
WHERE json_array_length(`grants_json`) > 0;
--> statement-breakpoint
-- Token scopes name projects by name: {"kind":"topics","topics":[…]} becomes
-- {"kind":"projects","projects":[…]}; {"kind":"all"} stays.
UPDATE `access_token` SET `scope_json` = json_object(
	'kind', 'projects',
	'projects', json(json_extract(`scope_json`, '$.topics'))
)
WHERE json_extract(`scope_json`, '$.kind') = 'topics';
