-- Marks each project's default Channel (`metadata.projectDefault`), which clients show under the
-- project's name. That is the project's oldest live group Channel, as `findProjectMainChannelId`
-- picks it, when it still has the title it was created with; a renamed one stays unmarked.
-- Merges into existing metadata (NULL included) and skips rows already marked, so it replays safely.
UPDATE "channels" AS "c"
SET "metadata" = COALESCE("c"."metadata", '{}'::jsonb) || '{"projectDefault": true}'::jsonb
FROM (
  SELECT DISTINCT ON ("project_id") "id"
  FROM "channels"
  WHERE "project_id" IS NOT NULL
    AND "agent_id" IS NULL
    AND "peer_user_id" IS NULL
    AND "is_deleted" IS NOT TRUE
  ORDER BY "project_id", "created_at", "id"
) AS "oldest"
WHERE "c"."id" = "oldest"."id"
  AND "c"."title" = 'General'
  AND ("c"."metadata" -> 'projectDefault') IS DISTINCT FROM 'true'::jsonb;
