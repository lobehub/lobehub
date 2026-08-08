-- Reseed OpenRouter catalog platform defaults: enable only the newest 4 chat
-- models per openai / anthropic / google family. All other rows stay disabled.
-- Idempotent; safe to re-run. Per-user `ai_models` overrides are unchanged.

--> statement-breakpoint
ALTER TABLE "openrouter_model_catalog" ALTER COLUMN "enabled" SET DEFAULT false;--> statement-breakpoint
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY split_part(id, '/', 1)
      ORDER BY released_at DESC NULLS LAST, id ASC
    ) AS rn
  FROM "openrouter_model_catalog"
  WHERE lower(coalesce(type, 'chat')) = 'chat'
    AND (
      id LIKE 'openai/%'
      OR id LIKE 'anthropic/%'
      OR id LIKE 'google/%'
    )
)
UPDATE "openrouter_model_catalog" AS c
SET
  "enabled" = EXISTS (
    SELECT 1 FROM ranked AS r WHERE r.id = c.id AND r.rn <= 4
  ),
  "updated_at" = now();
