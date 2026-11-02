BEGIN;

-- Browser continuation resolves function-calling support from the enabled-model
-- projection. Seed it only for the manual UI scenario so the core request
-- baseline remains independent of browser-only model discovery state.
INSERT INTO ai_models
  (id, display_name, provider_id, type, user_id, enabled, abilities, context_window_tokens, source, settings)
VALUES
  (
    'gpt-4o',
    'GPT-4o',
    'openai',
    'chat',
    'user_agent_testing_001',
    true,
    '{"functionCall":true,"vision":true}'::jsonb,
    128000,
    'builtin',
    '{}'::jsonb
  )
ON CONFLICT (id, provider_id, user_id) WHERE workspace_id IS NULL DO UPDATE SET
  enabled = EXCLUDED.enabled,
  abilities = EXCLUDED.abilities,
  context_window_tokens = EXCLUDED.context_window_tokens,
  updated_at = now();

COMMIT;
