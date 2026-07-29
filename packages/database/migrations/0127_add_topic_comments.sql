-- Topic Comments had one shared pre-release draft before this migration was
-- finalized. Accept only that exact draft (or the exact final shape on a safe
-- re-run); an unrelated or partially-created table must fail before any DDL
-- mutates it.
DO $$
DECLARE
	comments_exist boolean := to_regclass('public.topic_comments') IS NOT NULL;
	mentions_exist boolean := to_regclass('public.topic_comment_mentions') IS NOT NULL;
	comments_are_draft boolean := false;
	comments_are_final boolean := false;
	mentions_are_expected boolean := false;
	shape_details text;
BEGIN
	IF comments_exist IS DISTINCT FROM mentions_exist THEN
		RAISE EXCEPTION
			'Topic Comment migration found a partial pre-existing schema (topic_comments=%, topic_comment_mentions=%). Refusing to mutate an unknown shape.',
			comments_exist,
			mentions_exist;
	END IF;

	-- Neither table exists: this is the normal fresh-database path.
	IF NOT comments_exist THEN
		RETURN;
	END IF;

	IF (SELECT relkind FROM pg_class WHERE oid = 'public.topic_comments'::regclass) <> 'r'
		OR (SELECT relkind FROM pg_class WHERE oid = 'public.topic_comment_mentions'::regclass) <> 'r' THEN
		RAISE EXCEPTION 'Topic Comment migration requires ordinary public tables; refusing to mutate an unknown relation kind.';
	END IF;

	WITH actual(column_name, data_type, not_null, default_expression) AS (
		SELECT
			a.attname::text,
			format_type(a.atttypid, a.atttypmod),
			a.attnotnull,
			pg_get_expr(d.adbin, d.adrelid)
		FROM pg_attribute a
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE a.attrelid = 'public.topic_comments'::regclass
			AND a.attnum > 0
			AND NOT a.attisdropped
	), expected(column_name, data_type, not_null, default_expression) AS (
		VALUES
			('id', 'text', true, NULL::text),
			('topic_id', 'text', true, NULL::text),
			('message_id', 'text', false, NULL::text),
			('parent_comment_id', 'text', false, NULL::text),
			('author_user_id', 'text', false, NULL::text),
			('workspace_id', 'text', true, NULL::text),
			('content', 'text', true, NULL::text),
			('editor_data', 'jsonb', false, NULL::text),
			('client_id', 'text', true, NULL::text),
			('anchor_preview', 'jsonb', false, NULL::text),
			('deleted_at', 'timestamp with time zone', false, NULL::text),
			('created_at', 'timestamp with time zone', true, 'now()'),
			('updated_at', 'timestamp with time zone', true, 'now()')
	)
	SELECT NOT EXISTS (
		(SELECT * FROM actual EXCEPT SELECT * FROM expected)
		UNION ALL
		(SELECT * FROM expected EXCEPT SELECT * FROM actual)
	) INTO comments_are_draft;

	WITH actual(column_name, data_type, not_null, default_expression) AS (
		SELECT
			a.attname::text,
			format_type(a.atttypid, a.atttypmod),
			a.attnotnull,
			pg_get_expr(d.adbin, d.adrelid)
		FROM pg_attribute a
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE a.attrelid = 'public.topic_comments'::regclass
			AND a.attnum > 0
			AND NOT a.attisdropped
	), expected(column_name, data_type, not_null, default_expression) AS (
		VALUES
			('id', 'text', true, NULL::text),
			('topic_id', 'text', true, NULL::text),
			('message_id', 'text', false, NULL::text),
			('parent_comment_id', 'text', false, NULL::text),
			('author_user_id', 'text', false, NULL::text),
			('workspace_id', 'text', true, NULL::text),
			('content', 'text', true, NULL::text),
			('editor_data', 'jsonb', false, NULL::text),
			('client_id', 'text', true, NULL::text),
			('anchor_preview', 'jsonb', false, NULL::text),
			('deleted_at', 'timestamp with time zone', false, NULL::text),
			('moderated_at', 'timestamp with time zone', false, NULL::text),
			('moderated_by_user_id', 'text', false, NULL::text),
			('moderation_expires_at', 'timestamp with time zone', false, NULL::text),
			('created_at', 'timestamp with time zone', true, 'now()'),
			('updated_at', 'timestamp with time zone', true, 'now()')
	)
	SELECT NOT EXISTS (
		(SELECT * FROM actual EXCEPT SELECT * FROM expected)
		UNION ALL
		(SELECT * FROM expected EXCEPT SELECT * FROM actual)
	) INTO comments_are_final;

	IF NOT comments_are_draft AND NOT comments_are_final THEN
		SELECT string_agg(
			format(
				'%I %s%s default=%s',
				a.attname,
				format_type(a.atttypid, a.atttypmod),
				CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
				coalesce(pg_get_expr(d.adbin, d.adrelid), '<none>')
			),
			', ' ORDER BY a.attnum
		)
		INTO shape_details
		FROM pg_attribute a
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE a.attrelid = 'public.topic_comments'::regclass
			AND a.attnum > 0
			AND NOT a.attisdropped;

		RAISE EXCEPTION
			'Topic Comment migration found an unsupported topic_comments column shape: %',
			shape_details;
	END IF;

	WITH actual(column_name, data_type, not_null, default_expression) AS (
		SELECT
			a.attname::text,
			format_type(a.atttypid, a.atttypmod),
			a.attnotnull,
			pg_get_expr(d.adbin, d.adrelid)
		FROM pg_attribute a
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE a.attrelid = 'public.topic_comment_mentions'::regclass
			AND a.attnum > 0
			AND NOT a.attisdropped
	), expected(column_name, data_type, not_null, default_expression) AS (
		VALUES
			('id', 'uuid', true, 'gen_random_uuid()'),
			('comment_id', 'text', true, NULL::text),
			('mentioned_user_id', 'text', true, NULL::text),
			('workspace_id', 'text', true, NULL::text),
			('created_at', 'timestamp with time zone', true, 'now()')
	)
	SELECT NOT EXISTS (
		(SELECT * FROM actual EXCEPT SELECT * FROM expected)
		UNION ALL
		(SELECT * FROM expected EXCEPT SELECT * FROM actual)
	) INTO mentions_are_expected;

	IF NOT mentions_are_expected THEN
		SELECT string_agg(
			format(
				'%I %s%s default=%s',
				a.attname,
				format_type(a.atttypid, a.atttypmod),
				CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
				coalesce(pg_get_expr(d.adbin, d.adrelid), '<none>')
			),
			', ' ORDER BY a.attnum
		)
		INTO shape_details
		FROM pg_attribute a
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE a.attrelid = 'public.topic_comment_mentions'::regclass
			AND a.attnum > 0
			AND NOT a.attisdropped;

		RAISE EXCEPTION
			'Topic Comment migration found an unsupported topic_comment_mentions column shape: %',
			shape_details;
	END IF;

	-- Constraint and index names must match one complete known shape. Their
	-- definitions are recreated below, so a same-name draft definition is safe;
	-- unknown extra/missing objects are not.
	WITH actual(name) AS (
		SELECT conname::text
		FROM pg_constraint
		WHERE conrelid = 'public.topic_comments'::regclass
	), expected(name) AS (
		SELECT * FROM (
			VALUES
				('topic_comments_pkey'),
				('topic_comments_anchored_requires_preview'),
				('topic_comments_reply_has_no_anchor'),
				('topic_comments_topic_id_topics_id_fk'),
				('topic_comments_message_id_messages_id_fk'),
				('topic_comments_parent_comment_id_topic_comments_id_fk'),
				('topic_comments_author_user_id_users_id_fk'),
				('topic_comments_workspace_id_workspaces_id_fk'),
				('topic_comments_moderation_window_consistent'),
				('topic_comments_deleted_not_recoverable'),
				('topic_comments_moderated_by_user_id_users_id_fk')
		) AS names(name)
		WHERE comments_are_final
			OR name NOT IN (
				'topic_comments_moderation_window_consistent',
				'topic_comments_deleted_not_recoverable',
				'topic_comments_moderated_by_user_id_users_id_fk'
			)
	)
	SELECT string_agg(name, ', ' ORDER BY name)
	INTO shape_details
	FROM (
		(SELECT name FROM actual EXCEPT SELECT name FROM expected)
		UNION ALL
		(SELECT name FROM expected EXCEPT SELECT name FROM actual)
	) differences;

	IF shape_details IS NOT NULL THEN
		RAISE EXCEPTION
			'Topic Comment migration found unsupported topic_comments constraints (unexpected or missing: %).',
			shape_details;
	END IF;

	WITH actual(name) AS (
		SELECT index_class.relname::text
		FROM pg_index index_info
		JOIN pg_class index_class ON index_class.oid = index_info.indexrelid
		WHERE index_info.indrelid = 'public.topic_comments'::regclass
	), expected(name) AS (
		SELECT * FROM (
			VALUES
				('topic_comments_pkey'),
				('topic_comments_topic_id_author_user_id_client_id_unique'),
				('topic_comments_parent_comment_id_created_at_id_idx'),
				('topic_comments_topic_id_created_at_id_idx'),
				('topic_comments_topic_id_message_id_idx'),
				('topic_comments_message_id_idx'),
				('topic_comments_author_user_id_idx'),
				('topic_comments_workspace_id_idx'),
				('topic_comments_moderation_expires_at_idx'),
				('topic_comments_moderated_by_user_id_idx')
		) AS names(name)
		WHERE comments_are_final
			OR name NOT IN (
				'topic_comments_moderation_expires_at_idx',
				'topic_comments_moderated_by_user_id_idx'
			)
	)
	SELECT string_agg(name, ', ' ORDER BY name)
	INTO shape_details
	FROM (
		(SELECT name FROM actual EXCEPT SELECT name FROM expected)
		UNION ALL
		(SELECT name FROM expected EXCEPT SELECT name FROM actual)
	) differences;

	IF shape_details IS NOT NULL THEN
		RAISE EXCEPTION
			'Topic Comment migration found unsupported topic_comments indexes (unexpected or missing: %).',
			shape_details;
	END IF;

	WITH actual(name) AS (
		SELECT conname::text
		FROM pg_constraint
		WHERE conrelid = 'public.topic_comment_mentions'::regclass
	), expected(name) AS (
		VALUES
			('topic_comment_mentions_pkey'),
			('topic_comment_mentions_comment_id_topic_comments_id_fk'),
			('topic_comment_mentions_mentioned_user_id_users_id_fk'),
			('topic_comment_mentions_workspace_id_workspaces_id_fk')
	)
	SELECT string_agg(name, ', ' ORDER BY name)
	INTO shape_details
	FROM (
		(SELECT name FROM actual EXCEPT SELECT name FROM expected)
		UNION ALL
		(SELECT name FROM expected EXCEPT SELECT name FROM actual)
	) differences;

	IF shape_details IS NOT NULL THEN
		RAISE EXCEPTION
			'Topic Comment migration found unsupported topic_comment_mentions constraints (unexpected or missing: %).',
			shape_details;
	END IF;

	WITH actual(name) AS (
		SELECT index_class.relname::text
		FROM pg_index index_info
		JOIN pg_class index_class ON index_class.oid = index_info.indexrelid
		WHERE index_info.indrelid = 'public.topic_comment_mentions'::regclass
	), expected(name) AS (
		VALUES
			('topic_comment_mentions_pkey'),
			('topic_comment_mentions_comment_id_mentioned_user_id_unique'),
			('topic_comment_mentions_mentioned_user_id_created_at_idx'),
			('topic_comment_mentions_workspace_id_idx')
	)
	SELECT string_agg(name, ', ' ORDER BY name)
	INTO shape_details
	FROM (
		(SELECT name FROM actual EXCEPT SELECT name FROM expected)
		UNION ALL
		(SELECT name FROM expected EXCEPT SELECT name FROM actual)
	) differences;

	IF shape_details IS NOT NULL THEN
		RAISE EXCEPTION
			'Topic Comment migration found unsupported topic_comment_mentions indexes (unexpected or missing: %).',
			shape_details;
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint constraint_info
		WHERE constraint_info.conrelid = 'public.topic_comments'::regclass
			AND constraint_info.contype = 'p'
			AND constraint_info.conkey = ARRAY[
				(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.topic_comments'::regclass AND attname = 'id')
			]::smallint[]
	) OR NOT EXISTS (
		SELECT 1
		FROM pg_constraint constraint_info
		WHERE constraint_info.conrelid = 'public.topic_comment_mentions'::regclass
			AND constraint_info.contype = 'p'
			AND constraint_info.conkey = ARRAY[
				(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.topic_comment_mentions'::regclass AND attname = 'id')
			]::smallint[]
	) THEN
		RAISE EXCEPTION 'Topic Comment migration found an unsupported primary key definition.';
	END IF;
END
$$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "topic_comment_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" text NOT NULL,
	"mentioned_user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "topic_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"topic_id" text NOT NULL,
	"message_id" text,
	"parent_comment_id" text,
	"author_user_id" text,
	"workspace_id" text NOT NULL,
	"content" text NOT NULL,
	"editor_data" jsonb,
	"client_id" text NOT NULL,
	"anchor_preview" jsonb,
	"deleted_at" timestamp with time zone,
	"moderated_at" timestamp with time zone,
	"moderated_by_user_id" text,
	"moderation_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_comments_anchored_requires_preview" CHECK ("topic_comments"."message_id" IS NULL OR "topic_comments"."anchor_preview" IS NOT NULL),
	CONSTRAINT "topic_comments_reply_has_no_anchor" CHECK ("topic_comments"."parent_comment_id" IS NULL OR ("topic_comments"."message_id" IS NULL AND "topic_comments"."anchor_preview" IS NULL)),
	CONSTRAINT "topic_comments_moderation_window_consistent" CHECK (("topic_comments"."moderated_at" IS NULL) = ("topic_comments"."moderation_expires_at" IS NULL)),
	CONSTRAINT "topic_comments_deleted_not_recoverable" CHECK ("topic_comments"."deleted_at" IS NULL OR "topic_comments"."moderated_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "topic_comments" ADD COLUMN IF NOT EXISTS "moderated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "topic_comments" ADD COLUMN IF NOT EXISTS "moderated_by_user_id" text;--> statement-breakpoint
ALTER TABLE "topic_comments" ADD COLUMN IF NOT EXISTS "moderation_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_anchored_requires_preview";--> statement-breakpoint
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_anchored_requires_preview" CHECK ("message_id" IS NULL OR "anchor_preview" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_reply_has_no_anchor";--> statement-breakpoint
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_reply_has_no_anchor" CHECK ("parent_comment_id" IS NULL OR ("message_id" IS NULL AND "anchor_preview" IS NULL));--> statement-breakpoint
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_moderation_window_consistent";--> statement-breakpoint
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_moderation_window_consistent" CHECK (("moderated_at" IS NULL) = ("moderation_expires_at" IS NULL));--> statement-breakpoint
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_deleted_not_recoverable";--> statement-breakpoint
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_deleted_not_recoverable" CHECK ("deleted_at" IS NULL OR "moderated_at" IS NULL);--> statement-breakpoint
ALTER TABLE "topic_comment_mentions" DROP CONSTRAINT IF EXISTS "topic_comment_mentions_comment_id_topic_comments_id_fk";--> statement-breakpoint
ALTER TABLE "topic_comment_mentions" ADD CONSTRAINT "topic_comment_mentions_comment_id_topic_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."topic_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_comment_mentions" DROP CONSTRAINT IF EXISTS "topic_comment_mentions_mentioned_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "topic_comment_mentions" ADD CONSTRAINT "topic_comment_mentions_mentioned_user_id_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_comment_mentions" DROP CONSTRAINT IF EXISTS "topic_comment_mentions_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "topic_comment_mentions" ADD CONSTRAINT "topic_comment_mentions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_message_id_messages_id_fk";--> statement-breakpoint
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_parent_comment_id_topic_comments_id_fk";--> statement-breakpoint
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_parent_comment_id_topic_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."topic_comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_author_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_comments" DROP CONSTRAINT IF EXISTS "topic_comments_moderated_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "topic_comments" ADD CONSTRAINT "topic_comments_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DROP INDEX IF EXISTS "topic_comment_mentions_comment_id_mentioned_user_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "topic_comment_mentions_mentioned_user_id_created_at_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "topic_comment_mentions_workspace_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "topic_comments_topic_id_author_user_id_client_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "topic_comments_parent_comment_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "topic_comments_topic_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "topic_comments_topic_id_message_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "topic_comments_message_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "topic_comments_author_user_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "topic_comments_moderation_expires_at_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "topic_comments_moderated_by_user_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "topic_comments_workspace_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "topic_comment_mentions_comment_id_mentioned_user_id_unique" ON "topic_comment_mentions" USING btree ("comment_id","mentioned_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_comment_mentions_mentioned_user_id_created_at_idx" ON "topic_comment_mentions" USING btree ("mentioned_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_comment_mentions_workspace_id_idx" ON "topic_comment_mentions" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "topic_comments_topic_id_author_user_id_client_id_unique" ON "topic_comments" USING btree ("topic_id","author_user_id","client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_comments_parent_comment_id_created_at_id_idx" ON "topic_comments" USING btree ("parent_comment_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_comments_topic_id_created_at_id_idx" ON "topic_comments" USING btree ("topic_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_comments_topic_id_message_id_idx" ON "topic_comments" USING btree ("topic_id","message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_comments_message_id_idx" ON "topic_comments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_comments_author_user_id_idx" ON "topic_comments" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_comments_moderation_expires_at_idx" ON "topic_comments" USING btree ("moderation_expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_comments_moderated_by_user_id_idx" ON "topic_comments" USING btree ("moderated_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_comments_workspace_id_idx" ON "topic_comments" USING btree ("workspace_id");--> statement-breakpoint

-- Persist the Topic Comment permission rows before linking existing roles. IDs
-- are deterministic 16-character text values, matching the RBAC table's normal
-- application-generated ID width while keeping this backfill idempotent.
INSERT INTO "rbac_permissions" ("id", "code", "name", "category")
SELECT
	substring(md5('topic-comment-rbac:' || permission.code) from 1 for 16),
	permission.code,
	permission.name,
	'topic_comment'
FROM (
	VALUES
		('topic_comment:read:all', 'Topic Comment Read'),
		('topic_comment:create:all', 'Topic Comment Create'),
		('topic_comment:update:all', 'Topic Comment Update'),
		('topic_comment:delete:all', 'Topic Comment Delete'),
		('topic_comment:restore:all', 'Topic Comment Restore'),
		('topic_comment:create:owner', 'Topic Comment Create'),
		('topic_comment:update:owner', 'Topic Comment Update'),
		('topic_comment:delete:owner', 'Topic Comment Delete')
) AS permission(code, name)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

-- Backfill only the three workspace system roles plus the globally reserved
-- super_admin role. Legacy rows may predate the is_system flag, so its reserved
-- name + NULL workspace scope identify it. Workspace custom roles deliberately
-- retain their administrator-selected permission set.
INSERT INTO "rbac_role_permissions" ("role_id", "permission_id")
SELECT role.id, permission.id
FROM (
	VALUES
		('workspace_owner', true, 'topic_comment:read:all'),
		('workspace_owner', true, 'topic_comment:create:all'),
		('workspace_owner', true, 'topic_comment:update:all'),
		('workspace_owner', true, 'topic_comment:delete:all'),
		('workspace_owner', true, 'topic_comment:restore:all'),
		('workspace_member', true, 'topic_comment:read:all'),
		('workspace_member', true, 'topic_comment:create:owner'),
		('workspace_member', true, 'topic_comment:update:owner'),
		('workspace_member', true, 'topic_comment:delete:owner'),
		('workspace_viewer', true, 'topic_comment:read:all'),
		('super_admin', false, 'topic_comment:read:all'),
		('super_admin', false, 'topic_comment:create:all'),
		('super_admin', false, 'topic_comment:update:all'),
		('super_admin', false, 'topic_comment:delete:all'),
		('super_admin', false, 'topic_comment:restore:all')
) AS grant_spec(role_name, workspace_scoped, permission_code)
JOIN "rbac_roles" role
	ON role.name = grant_spec.role_name
	AND (
		(grant_spec.workspace_scoped AND role.is_system = true AND role.workspace_id IS NOT NULL)
		OR (NOT grant_spec.workspace_scoped AND role.workspace_id IS NULL)
	)
JOIN "rbac_permissions" permission ON permission.code = grant_spec.permission_code
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
