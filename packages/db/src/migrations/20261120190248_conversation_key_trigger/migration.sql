-- The snapshot records the `''` default the previous migration added. drizzle-kit
-- generated a table rebuild for it, replaced here: the column already has that default,
-- and dropping `message` on D1 would cascade-delete reads and responses.
--
-- An insert that leaves conversation_key out gets the derived key instead of `''`,
-- which would not be a valid conversation key.
CREATE TRIGGER `message_conversation_key_default`
AFTER INSERT ON `message`
FOR EACH ROW WHEN NEW.`conversation_key` = ''
BEGIN
	UPDATE `message` SET `conversation_key` = CASE
		WHEN json_extract(NEW.`conversation_json`, '$.id') IS NOT NULL
			THEN 'c:' || json_extract(NEW.`conversation_json`, '$.id')
		ELSE 't:' || NEW.`topic_id`
	END
	WHERE `id` = NEW.`id`;
END;
