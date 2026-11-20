-- SQLite cannot add a NOT NULL column without a default, and rebuilding `message`
-- would cascade-delete reads and responses on D1 (foreign keys stay on). So the column
-- gets a placeholder default, existing rows are backfilled, and every insert sets it.
ALTER TABLE `message` ADD `conversation_key` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `message` SET `conversation_key` = CASE
	WHEN json_extract(`conversation_json`, '$.id') IS NOT NULL
		THEN 'c:' || json_extract(`conversation_json`, '$.id')
	ELSE 't:' || `topic_id`
END;--> statement-breakpoint
CREATE INDEX `message_topicId_conversationKey_id_idx` ON `message` (`topic_id`,`conversation_key`,`id`);
