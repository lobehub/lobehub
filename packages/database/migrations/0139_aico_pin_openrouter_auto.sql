-- Pin product Auto in the OpenRouter catalog defaults.
-- Idempotent; safe to re-run. Per-user `ai_models` overrides are unchanged.

--> statement-breakpoint
UPDATE "openrouter_model_catalog"
SET
  "enabled" = true,
  "display_name" = COALESCE("display_name", 'Panachat Auto'),
  "updated_at" = now()
WHERE "id" = 'openrouter/auto';
