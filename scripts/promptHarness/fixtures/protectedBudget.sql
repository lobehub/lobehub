BEGIN;

INSERT INTO topics
  (id, user_id, title, agent_id, mode, created_at, updated_at, accessed_at)
VALUES
  (
    'tpc_T106PROTECTEDBUDGET',
    'user_agent_testing_001',
    'T106 protected budget fixture',
    'agt_T106PROTECTED01',
    'agent',
    '2026-11-02T11:55:00.000Z',
    '2026-11-02T11:55:00.000Z',
    '2026-11-02T11:55:00.000Z'
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  agent_id = EXCLUDED.agent_id,
  updated_at = EXCLUDED.updated_at;

INSERT INTO messages
  (id, role, content, user_id, topic_id, agent_id, parent_id, tools, created_at, updated_at)
VALUES
  (
    'msg_T106PROTECTED_SAFETY',
    'assistant',
    '',
    'user_agent_testing_001',
    'tpc_T106PROTECTEDBUDGET',
    'agt_T106PROTECTED01',
    NULL,
    '[{"id":"call_T106_PROTECTED_PENDING","type":"builtin","apiName":"requestCheckpoint","arguments":"{\"reason\":\"T106 PENDING ACTION: approve canary rollout before deployment\"}","identifier":"lobe-brief"}]'::jsonb,
    '2026-11-02T11:55:10.000Z',
    '2026-11-02T11:55:10.000Z'
  ),
  (
    'msg_T106PROTECTED_PENDING_TOOL',
    'tool',
    'T106 PENDING ACTION: approve canary rollout before deployment',
    'user_agent_testing_001',
    'tpc_T106PROTECTEDBUDGET',
    'agt_T106PROTECTED01',
    'msg_T106PROTECTED_SAFETY',
    NULL,
    '2026-11-02T11:55:11.000Z',
    '2026-11-02T11:55:11.000Z'
  )
ON CONFLICT (id) DO UPDATE SET
  content = EXCLUDED.content,
  tools = EXCLUDED.tools,
  parent_id = EXCLUDED.parent_id,
  updated_at = EXCLUDED.updated_at;

INSERT INTO message_plugins
  (id, tool_call_id, type, api_name, arguments, identifier, state, intervention, user_id)
VALUES
  (
    'msg_T106PROTECTED_PENDING_TOOL',
    'call_T106_PROTECTED_PENDING',
    'builtin',
    'requestCheckpoint',
    '{"reason":"T106 PENDING ACTION: approve canary rollout before deployment"}',
    'lobe-brief',
    '{"status":"pending"}'::jsonb,
    '{"status":"pending","reason":"T106 PENDING ACTION: approve canary rollout before deployment"}'::jsonb,
    'user_agent_testing_001'
  )
ON CONFLICT (id) DO UPDATE SET
  arguments = EXCLUDED.arguments,
  state = EXCLUDED.state,
  intervention = EXCLUDED.intervention;

COMMIT;
