-- `allowFrom` used to be a global sender gate even when the per-surface
-- policies were open or omitted. Preserve that access boundary when open
-- policies become truly permissive.
UPDATE "agent_bot_providers"
SET "settings" = COALESCE("settings", '{}'::jsonb)
  || CASE
    WHEN COALESCE("settings" ->> 'dmPolicy', 'open') = 'open'
      THEN '{"dmPolicy":"allowlist"}'::jsonb
    ELSE '{}'::jsonb
  END
  || CASE
    WHEN "platform" = 'telegram'
      AND COALESCE("settings" ->> 'guestPolicy', 'open') = 'open'
      THEN '{"guestPolicy":"allowlist"}'::jsonb
    ELSE '{}'::jsonb
  END
WHERE CASE jsonb_typeof("settings" -> 'allowFrom')
  WHEN 'array' THEN EXISTS (
    SELECT 1
    FROM jsonb_array_elements("settings" -> 'allowFrom') AS entry
    WHERE CASE jsonb_typeof(entry)
      WHEN 'string' THEN btrim(entry #>> '{}') <> ''
      WHEN 'object' THEN btrim(COALESCE(entry ->> 'id', '')) <> ''
      ELSE false
    END
  )
  WHEN 'string' THEN regexp_replace("settings" ->> 'allowFrom', '[[:space:],]+', '', 'g') <> ''
  ELSE false
END
AND (
  COALESCE("settings" ->> 'dmPolicy', 'open') = 'open'
  OR (
    "platform" = 'telegram'
    AND COALESCE("settings" ->> 'guestPolicy', 'open') = 'open'
  )
);
