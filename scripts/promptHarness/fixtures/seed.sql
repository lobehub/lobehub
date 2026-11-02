BEGIN;

INSERT INTO agents
  (id, title, system_role, user_id, model, provider, plugins, chat_config, params, tags, visibility)
VALUES
  (
    'agt_yLie7JpbUr2K',
    'T105 On-demand harness',
    E'  User-authored Agent Prompt\n\tkeep every byte and never rewrite this instruction.  ',
    'user_agent_testing_001',
    'gpt-4o',
    'openai',
    '[]'::jsonb,
    '{"toolMode":"agent","promptMode":"full","contextMode":"on-demand","selfIteration":{"enabled":false},"enableAgentMode":true,"enableStreaming":true,"enableHistoryCount":false,"enableFollowUpChips":false}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    'private'
  ),
  (
    'agt_T101LEGACY01',
    'T105 Legacy control',
    E'  User-authored Agent Prompt\n\tkeep every byte and never rewrite this instruction.  ',
    'user_agent_testing_001',
    'gpt-4o',
    'openai',
    '[]'::jsonb,
    '{"toolMode":"agent","promptMode":"full","contextMode":"default","selfIteration":{"enabled":false},"enableAgentMode":true,"enableStreaming":true,"enableHistoryCount":false,"enableFollowUpChips":false}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    'private'
  ),
  (
    'agt_T106CHAT01',
    'T106 Legacy chat control',
    E'  User-authored Agent Prompt\n\tkeep every byte and never rewrite this instruction.  ',
    'user_agent_testing_001',
    'gpt-4o',
    'openai',
    '[]'::jsonb,
    '{"toolMode":"chat","promptMode":"full","contextMode":"default","selfIteration":{"enabled":false},"enableAgentMode":false,"enableStreaming":true,"enableHistoryCount":false,"enableFollowUpChips":false}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    'private'
  ),
  (
    'agt_T105BUDGET01',
    'T105 Budget-pressure harness',
    'T105 budget-pressure control prompt.',
    'user_agent_testing_001',
    'gpt-4o',
    'openai',
    '[]'::jsonb,
    '{"toolMode":"agent","promptMode":"full","contextMode":"on-demand","selfIteration":{"enabled":false},"enableAgentMode":true,"enableStreaming":true,"enableHistoryCount":false,"enableFollowUpChips":false}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    'private'
  ),
  (
    'agt_T106UI01',
    'T106 intervention UI harness',
    'T106 intervention UI control prompt.',
    'user_agent_testing_001',
    'gpt-4o',
    'openai',
    '["lobe-user-interaction"]'::jsonb,
    '{"toolMode":"agent","promptMode":"full","contextMode":"on-demand","selfIteration":{"enabled":false},"enableAgentMode":true,"enableStreaming":true,"enableHistoryCount":false,"enableFollowUpChips":false}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    'private'
  ),
  (
    'agt_T106NEGATIVE01',
    'T106 fail-closed harness',
    'T106 fail-closed activation control prompt.',
    'user_agent_testing_001',
    'gpt-4o',
    'openai',
    '[]'::jsonb,
    '{"toolMode":"agent","promptMode":"full","contextMode":"on-demand","selfIteration":{"enabled":false},"enableAgentMode":true,"enableStreaming":true,"enableHistoryCount":false,"enableFollowUpChips":false}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    'private'
  ),
  (
    'agt_T106PROTECTED01',
    'T106 protected-budget harness',
    'SAFETY RULE T106: destructive deployment is forbidden without two reviewers.',
    'user_agent_testing_001',
    'gpt-4o',
    'openai',
    '["lobe-calculator"]'::jsonb,
    '{"toolMode":"agent","promptMode":"full","contextMode":"on-demand","selfIteration":{"enabled":false},"enableAgentMode":true,"enableStreaming":true,"enableHistoryCount":false,"enableFollowUpChips":false}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    'private'
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  system_role = EXCLUDED.system_role,
  model = EXCLUDED.model,
  provider = EXCLUDED.provider,
  plugins = EXCLUDED.plugins,
  chat_config = EXCLUDED.chat_config,
  updated_at = now();

WITH generated AS (
  SELECT string_agg(
    format('T105-LINE-%s checkpoint evidence: %s', line, repeat('chapter-window-marker ', 6)),
    E'\n'
    ORDER BY line
  ) AS content
  FROM generate_series(1, 2200) AS line
)
INSERT INTO documents
  (id, title, content, file_type, filename, total_char_count, total_line_count, source, source_type, user_id)
SELECT
  'doc_t105_long_doc',
  'T105 Long Document',
  content,
  'markdown',
  't105-long-document.md',
  length(content),
  2200,
  'agent',
  'agent',
  'user_agent_testing_001'
FROM generated
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  total_char_count = EXCLUDED.total_char_count,
  total_line_count = EXCLUDED.total_line_count,
  updated_at = now();

INSERT INTO documents
  (id, title, description, content, file_type, filename, total_char_count, total_line_count, source, source_type, user_id)
VALUES
  (
    'doc_t105_budget_pressure',
    'T105 Budget Pressure Document',
    repeat('T105_BUDGET_PRESSURE release rollback deployment low relevance memory ', 1200),
    'Budget pressure fixture content.',
    'markdown',
    't105-budget-pressure.md',
    length('Budget pressure fixture content.'),
    1,
    'agent',
    'agent',
    'user_agent_testing_001'
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  content = EXCLUDED.content,
  total_char_count = EXCLUDED.total_char_count,
  total_line_count = EXCLUDED.total_line_count,
  updated_at = now();

INSERT INTO agent_documents
  (id, user_id, agent_id, document_id, access_self, policy_load, policy_load_format)
VALUES
  (
    'a1050000-0000-4000-8000-000000000001',
    'user_agent_testing_001',
    'agt_yLie7JpbUr2K',
    'doc_t105_long_doc',
    31,
    'always',
    'raw'
  ),
  (
    'a1050000-0000-4000-8000-000000000002',
    'user_agent_testing_001',
    'agt_T101LEGACY01',
    'doc_t105_long_doc',
    31,
    'disabled',
    'raw'
  ),
  (
    'a1050000-0000-4000-8000-000000000003',
    'user_agent_testing_001',
    'agt_T105BUDGET01',
    'doc_t105_budget_pressure',
    31,
    'always',
    'raw'
  ),
  (
    'a1060000-0000-4000-8000-000000000004',
    'user_agent_testing_001',
    'agt_T106PROTECTED01',
    'doc_t105_budget_pressure',
    31,
    'always',
    'raw'
  )
ON CONFLICT (id) DO UPDATE SET
  agent_id = EXCLUDED.agent_id,
  document_id = EXCLUDED.document_id,
  policy_load = EXCLUDED.policy_load,
  updated_at = now();

INSERT INTO user_memories
  (id, user_id, memory_layer, memory_type, title, summary, status, last_accessed_at)
VALUES
  (
    't105-memory-explicit',
    'user_agent_testing_001',
    'preference',
    'preference',
    'T105 release rollback deployment constraint',
    'T105 release rollback deployment must keep the rollback gate enabled.',
    'active',
    now()
  ),
  (
    't105-memory-unrelated',
    'user_agent_testing_001',
    'preference',
    'preference',
    'T105 cooking preference',
    'Prefer low-salt recipes when cooking.',
    'active',
    now()
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  updated_at = now();

INSERT INTO user_memories_preferences
  (id, user_memory_id, user_id, conclusion_directives, type, metadata, score_priority)
VALUES
  (
    't105-pref-explicit',
    't105-memory-explicit',
    'user_agent_testing_001',
    'T105 release rollback deployment: keep the rollback gate enabled for every candidate release.',
    'constraint',
    '{"explicit":true,"constraintKind":"constraint","conflictKey":"t105-release-mode"}'::jsonb,
    100
  ),
  (
    't105-pref-cooking',
    't105-memory-unrelated',
    'user_agent_testing_001',
    'T106 cooking preference: prefer low-salt recipes for this user.',
    'style',
    '{"explicit":false,"kind":"preference"}'::jsonb,
    50
  )
ON CONFLICT (id) DO UPDATE SET
  conclusion_directives = EXCLUDED.conclusion_directives,
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO user_memory_persona_documents
  (id, user_id, profile, tagline, persona, version)
VALUES
  (
    't105-persona',
    'user_agent_testing_001',
    'default',
    'Evidence-first operator',
    E'## T105 release rollback deployment\nKeep the rollback gate enabled. Preserve evidence provenance.',
    1
  )
ON CONFLICT (user_id, profile) DO UPDATE SET
  tagline = EXCLUDED.tagline,
  persona = EXCLUDED.persona,
  version = EXCLUDED.version,
  updated_at = now();

-- The harness mock records Chat Completions envelopes. The browser otherwise
-- selects OpenAI's Responses API and sends auxiliary discovery requests that
-- are outside the fixture scenario, so pin this provider to one protocol.
UPDATE ai_providers
SET
  config = COALESCE(config, '{}'::jsonb) || '{"enableResponseApi":false}'::jsonb,
  updated_at = now()
WHERE
  id = 'openai'
  AND user_id = 'user_agent_testing_001'
  AND workspace_id IS NULL;

COMMIT;
