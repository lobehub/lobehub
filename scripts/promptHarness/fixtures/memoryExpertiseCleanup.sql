BEGIN;

DELETE FROM expertise_lesson_revisions
WHERE lesson_id IN (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000005'
);
DELETE FROM expertise_lessons
WHERE id IN (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000005'
);
DELETE FROM expertise_bindings
WHERE id IN (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005'
);
DELETE FROM expertise_domains
WHERE id IN (
  't100-domain-approved',
  't100-domain-pending',
  't100-domain-revoked',
  't100-domain-stale',
  't100-domain-mismatch'
);
DELETE FROM user_memories_preferences
WHERE id IN ('t100-pref-explicit', 't100-pref-stable');
DELETE FROM user_memories_identities WHERE id = 't100-identity';
DELETE FROM user_memories
WHERE id IN ('t100-memory-explicit', 't100-memory-stable', 't100-memory-identity');

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
  id = EXCLUDED.id,
  tagline = EXCLUDED.tagline,
  persona = EXCLUDED.persona,
  version = EXCLUDED.version,
  updated_at = now();

COMMIT;
