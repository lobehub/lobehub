BEGIN;

INSERT INTO user_memories
  (id, user_id, memory_layer, memory_type, title, summary, status, last_accessed_at)
VALUES
  (
    't100-memory-explicit',
    'user_agent_testing_001',
    'preference',
    'preference',
    'T106 release rollback deployment priority approval gate explicit constraint',
    'T106 release rollback deployment priority approval gate rule',
    'active',
    now()
  ),
  (
    't100-memory-stable',
    'user_agent_testing_001',
    'preference',
    'preference',
    'T106 release rollback deployment priority approval gate stable preference',
    'T106 release rollback deployment priority approval gate preference',
    'active',
    now()
  ),
  (
    't100-memory-identity',
    'user_agent_testing_001',
    'identity',
    'identity',
    'T100 release rollback deployment operator',
    'T100 release rollback deployment identity',
    'active',
    now()
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  status = EXCLUDED.status,
  updated_at = now();

INSERT INTO user_memories_preferences
  (id, user_memory_id, user_id, conclusion_directives, type, metadata, score_priority)
VALUES
  (
    't100-pref-explicit',
    't100-memory-explicit',
    'user_agent_testing_001',
    'T106 release rollback deployment priority approval gate: always use blue-green deploy and keep rollback enabled.',
    'constraint',
    '{"explicit":true,"constraintKind":"constraint","conflictKey":"t100-release-mode"}'::jsonb,
    100
  ),
  (
    't100-pref-stable',
    't100-memory-stable',
    'user_agent_testing_001',
    'T106 release rollback deployment priority approval gate: use canary deploy without rollback.',
    'preference',
    '{"explicit":false,"kind":"preference","conflictKey":"t100-release-mode"}'::jsonb,
    10
  )
ON CONFLICT (id) DO UPDATE SET
  conclusion_directives = EXCLUDED.conclusion_directives,
  metadata = EXCLUDED.metadata,
  score_priority = EXCLUDED.score_priority,
  updated_at = now();

INSERT INTO user_memories_identities
  (id, user_memory_id, user_id, role, description, type)
VALUES
  (
    't100-identity',
    't100-memory-identity',
    'user_agent_testing_001',
    'T100 release rollback deployment operator',
    'Handles T100 release rollback deployment checks.',
    'role'
  )
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role,
  description = EXCLUDED.description,
  updated_at = now();

INSERT INTO user_memory_persona_documents
  (id, user_id, profile, tagline, persona, version)
VALUES
  (
    't100-persona',
    'user_agent_testing_001',
    'default',
    'Release operator',
    E'## T100 release rollback deployment\nAlways announce the T100 rollback gate before deployment.\n\n## Cooking\nPrefer low-salt recipes.',
    7
  )
ON CONFLICT (user_id, profile) DO UPDATE SET
  tagline = EXCLUDED.tagline,
  persona = EXCLUDED.persona,
  version = EXCLUDED.version,
  updated_at = now();

INSERT INTO expertise_domains
  (id, slug, title, description, user_id, visibility, domain_filter, layers, canon_entries, flow, evidence_spec)
VALUES
  (
    't100-domain-approved',
    't100-approved',
    'T100 approved expertise',
    'Approved fixture',
    'user_agent_testing_001',
    'private',
    'T100 fixture only',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    't100-domain-pending',
    't100-pending',
    'T100 pending expertise',
    'Pending fixture',
    'user_agent_testing_001',
    'private',
    'T100 fixture only',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    't100-domain-revoked',
    't100-revoked',
    'T100 revoked expertise',
    'Revoked fixture',
    'user_agent_testing_001',
    'private',
    'T100 fixture only',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    't100-domain-stale',
    't100-stale',
    'T100 stale expertise',
    'Stale fixture',
    'user_agent_testing_001',
    'private',
    'T100 fixture only',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    't100-domain-mismatch',
    't100-mismatch',
    'T100 hash mismatch expertise',
    'Mismatch fixture',
    'user_agent_testing_001',
    'private',
    'T100 fixture only',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  updated_at = now();

INSERT INTO expertise_bindings
  (id, domain_id, agent_id, bound_user_id, added_by_user_id, enabled)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    't100-domain-approved',
    'agt_yLie7JpbUr2K',
    NULL,
    'user_agent_testing_001',
    true
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    't100-domain-pending',
    'agt_yLie7JpbUr2K',
    NULL,
    'user_agent_testing_001',
    true
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    't100-domain-revoked',
    'agt_yLie7JpbUr2K',
    NULL,
    'user_agent_testing_001',
    true
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    't100-domain-stale',
    'agt_yLie7JpbUr2K',
    NULL,
    'user_agent_testing_001',
    true
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    't100-domain-mismatch',
    'agt_yLie7JpbUr2K',
    NULL,
    'user_agent_testing_001',
    true
  )
ON CONFLICT (id) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  updated_at = now();

INSERT INTO expertise_lessons
  (id, domain_id, created_by_user_id, code, polarity, title, sections, status, current_revision)
VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    't100-domain-approved',
    'user_agent_testing_001',
    'T100-A',
    'rule',
    'T100 approved rollback lesson',
    '[{"key":"rule","body":"APPROVED-EXPERTISE T100 release rollback deployment requires two reviewers."}]'::jsonb,
    'active',
    2
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    't100-domain-pending',
    'user_agent_testing_001',
    'T100-P',
    'rule',
    'T100 pending rollback lesson',
    '[{"key":"rule","body":"PENDING-SUGGESTION T100 release rollback deployment uses an agent proposal."}]'::jsonb,
    'active',
    2
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    't100-domain-revoked',
    'user_agent_testing_001',
    'T100-R',
    'rule',
    'T100 revoked rollback lesson',
    '[{"key":"rule","body":"REVOKED-SUGGESTION T100 release rollback deployment was rejected."}]'::jsonb,
    'rejected',
    2
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    't100-domain-stale',
    'user_agent_testing_001',
    'T100-S',
    'rule',
    'T100 stale rollback lesson',
    '[{"key":"rule","body":"STALE-SUGGESTION T100 release rollback deployment is stale."}]'::jsonb,
    'active',
    2
  ),
  (
    '20000000-0000-4000-8000-000000000005',
    't100-domain-mismatch',
    'user_agent_testing_001',
    'T100-H',
    'rule',
    'T100 mismatch rollback lesson',
    '[{"key":"rule","body":"HASH-MISMATCH-SUGGESTION T100 release rollback deployment changed after approval."}]'::jsonb,
    'active',
    2
  )
ON CONFLICT (id) DO UPDATE SET
  sections = EXCLUDED.sections,
  status = EXCLUDED.status,
  current_revision = EXCLUDED.current_revision,
  updated_at = now();

INSERT INTO expertise_lesson_revisions
  (id, lesson_id, revision, sections, feedback, changed_by, changed_by_user_id)
VALUES
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    2,
    '[{"key":"rule","body":"APPROVED-EXPERTISE T100 release rollback deployment requires two reviewers."}]'::jsonb,
    'User approved this lesson.',
    'user',
    'user_agent_testing_001'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    2,
    '[{"key":"rule","body":"PENDING-SUGGESTION T100 release rollback deployment uses an agent proposal."}]'::jsonb,
    'Agent proposed this lesson.',
    'agent',
    'user_agent_testing_001'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000003',
    2,
    '[{"key":"rule","body":"REVOKED-SUGGESTION T100 release rollback deployment was rejected."}]'::jsonb,
    'User rejected this lesson.',
    'user',
    'user_agent_testing_001'
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000004',
    1,
    '[{"key":"rule","body":"STALE-SUGGESTION T100 release rollback deployment is stale."}]'::jsonb,
    'Old revision.',
    'user',
    'user_agent_testing_001'
  ),
  (
    '30000000-0000-4000-8000-000000000005',
    '20000000-0000-4000-8000-000000000005',
    2,
    '[{"key":"rule","body":"HASH-MISMATCH APPROVED SOURCE BODY."}]'::jsonb,
    'Approved source body differs.',
    'user',
    'user_agent_testing_001'
  )
ON CONFLICT (lesson_id, revision) DO UPDATE SET
  sections = EXCLUDED.sections,
  feedback = EXCLUDED.feedback,
  changed_by = EXCLUDED.changed_by;

COMMIT;
