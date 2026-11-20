-- Every conversation is a feature: publishing with `conversation.id` now finds or creates
-- the project's feature for it. This gives conversations stored before that a feature
-- row too, so they show up in `features.list` with their last activity.
--
-- Data only, hand-written (drizzle-kit generate --custom). Only conversation ids that are
-- already valid feature slugs (the `feature_slug_check` rule) get a feature; any other id
-- keeps working as an inbox thread (`c:<id>`) without one. Ids already taken by a feature
-- in the same project are skipped, and expired messages are ignored. The name is the
-- latest message's conversation title, else the id. Feature ids are `fea_` and 26 random
-- hex chars, which fit the id format (`fea_[0-9a-z]{26}`); nothing pages features by id.
INSERT INTO `feature` (`id`, `project_id`, `slug`, `name`, `created_at`, `updated_at`, `last_message_at`)
SELECT
	'fea_' || lower(hex(randomblob(13))),
	`c`.`project_id`,
	`c`.`slug`,
	coalesce(
		nullif(
			substr(trim((
				SELECT json_extract(`m`.`conversation_json`, '$.title')
				FROM `message` `m`
				WHERE `m`.`project_id` = `c`.`project_id` AND `m`.`conversation_key` = `c`.`conversation_key`
				ORDER BY `m`.`created_at` DESC, `m`.`id` DESC
				LIMIT 1
			)), 1, 64),
			''
		),
		`c`.`slug`
	),
	`c`.`first_at`,
	`c`.`last_at`,
	`c`.`last_at`
FROM (
	SELECT
		`project_id`,
		`conversation_key`,
		substr(`conversation_key`, 3) AS `slug`,
		min(`created_at`) AS `first_at`,
		max(`created_at`) AS `last_at`
	FROM `message`
	WHERE substr(`conversation_key`, 1, 2) = 'c:'
		AND `expires_at` > cast(unixepoch('subsecond') * 1000 as integer)
	GROUP BY `project_id`, `conversation_key`
) `c`
WHERE length(`c`.`slug`) BETWEEN 1 AND 63
	AND `c`.`slug` NOT GLOB '*[^a-z0-9-]*'
	AND substr(`c`.`slug`, 1, 1) <> '-'
	AND NOT EXISTS (
		SELECT 1 FROM `feature` `f`
		WHERE `f`.`project_id` = `c`.`project_id` AND `f`.`slug` = `c`.`slug`
	);
