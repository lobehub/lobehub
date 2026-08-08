-- Seed cheap default models onto empty Unspecified (is_default) teams.
-- Skips any default team that already has team-scoped model_access_rules
-- (manager-customized allow-lists are left untouched). Idempotent.

--> statement-breakpoint
INSERT INTO "model_access_rules" ("id", "org_id", "scope", "team_id", "model_id")
SELECT
  'mar_' || substr(md5(t.id || ':' || m.model_id), 1, 12),
  t.org_id,
  'team',
  t.id,
  m.model_id
FROM "organization_teams" AS t
CROSS JOIN (
  VALUES
    ('openai/gpt-4o-mini'),
    ('google/gemini-2.0-flash-001'),
    ('deepseek/deepseek-chat-v3-0324')
) AS m(model_id)
WHERE t.is_default = true
  AND NOT EXISTS (
    SELECT 1
    FROM "model_access_rules" AS r
    WHERE r.team_id = t.id
      AND r.scope = 'team'
  );
