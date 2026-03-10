# LoCoMo Benchmark Ingest Guide

This folder contains the LoCoMo benchmark ingestor (`run.ts`). It loads `locomo10.json` and posts each sample to `/api/webhooks/memory-extraction/benchmark-locomo`, creating one user per sample with the ID pattern `locomo-user-${sampleId}`.

## 1. Seed benchmark users

Run this SQL before ingesting so the webhook has user records to attach memories to:

```sql
INSERT INTO users (id, email, normalized_email, username) VALUES
  ('locomo-user-conv-26', 'locomo1-conv-26@example.com', 'LOCOMO1_CONV26@EXAMPLE.COM', 'locomo1-conv-26'),
  ('locomo-user-conv-30', 'locomo1-conv-30@example.com', 'LOCOMO1_CONV30@EXAMPLE.COM', 'locomo1-conv-30'),
  ('locomo-user-conv-41', 'locomo1-conv-41@example.com', 'LOCOMO1_CONV41@EXAMPLE.COM', 'locomo1-conv-41'),
  ('locomo-user-conv-42', 'locomo1-conv-42@example.com', 'LOCOMO1_CONV42@EXAMPLE.COM', 'locomo1-conv-42'),
  ('locomo-user-conv-43', 'locomo1-conv-43@example.com', 'LOCOMO1_CONV43@EXAMPLE.COM', 'locomo1-conv-43'),
  ('locomo-user-conv-44', 'locomo1-conv-44@example.com', 'LOCOMO1_CONV44@EXAMPLE.COM', 'locomo1-conv-44'),
  ('locomo-user-conv-47', 'locomo1-conv-47@example.com', 'LOCOMO1_CONV47@EXAMPLE.COM', 'locomo1-conv-47'),
  ('locomo-user-conv-48', 'locomo1-conv-48@example.com', 'LOCOMO1_CONV48@EXAMPLE.COM', 'locomo1-conv-48'),
  ('locomo-user-conv-49', 'locomo1-conv-49@example.com', 'LOCOMO1_CONV49@EXAMPLE.COM', 'locomo1-conv-49'),
  ('locomo-user-conv-50', 'locomo1-conv-50@example.com', 'LOCOMO1_CONV50@EXAMPLE.COM', 'locomo1-conv-50')
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      normalized_email = EXCLUDED.normalized_email,
      username = EXCLUDED.username;

-- optional: ensure settings rows exist
INSERT INTO user_settings (id) VALUES
  ('locomo-user-conv-26'), ('locomo-user-conv-30'), ('locomo-user-conv-41'), ('locomo-user-conv-42'),
  ('locomo-user-conv-43'), ('locomo-user-conv-44'), ('locomo-user-conv-47'), ('locomo-user-conv-48'),
  ('locomo-user-conv-49'), ('locomo-user-conv-50')
ON CONFLICT DO NOTHING;
```

## 2. Clear benchmark memories (reset)

Use this to strip extraction metadata from topics and delete all benchmark memory rows for the same users. Each statement includes its own CTE so it works in a multi-statement script:

```sql
WITH target_users AS (
  SELECT UNNEST(ARRAY[
    'locomo-user-conv-26','locomo-user-conv-30','locomo-user-conv-41',
    'locomo-user-conv-42','locomo-user-conv-43','locomo-user-conv-44',
    'locomo-user-conv-47','locomo-user-conv-48','locomo-user-conv-49','locomo-user-conv-50'
  ]) AS user_id
)
UPDATE topics t
SET metadata = metadata #- '{userMemoryExtractRunState}'
FROM target_users u
WHERE t.user_id = u.user_id;

WITH target_users AS (
  SELECT UNNEST(ARRAY[
    'locomo-user-conv-26','locomo-user-conv-30','locomo-user-conv-41',
    'locomo-user-conv-42','locomo-user-conv-43','locomo-user-conv-44',
    'locomo-user-conv-47','locomo-user-conv-48','locomo-user-conv-49','locomo-user-conv-50'
  ]) AS user_id
)
UPDATE topics t
SET metadata = metadata #- '{userMemoryExtractStatus}'
FROM target_users u
WHERE t.user_id = u.user_id;

WITH target_users AS (
  SELECT UNNEST(ARRAY[
    'locomo-user-conv-26','locomo-user-conv-30','locomo-user-conv-41',
    'locomo-user-conv-42','locomo-user-conv-43','locomo-user-conv-44',
    'locomo-user-conv-47','locomo-user-conv-48','locomo-user-conv-49','locomo-user-conv-50'
  ]) AS user_id
)
DELETE FROM user_memories_experiences USING target_users u WHERE user_memories_experiences.user_id = u.user_id;

WITH target_users AS (
  SELECT UNNEST(ARRAY[
    'locomo-user-conv-26','locomo-user-conv-30','locomo-user-conv-41',
    'locomo-user-conv-42','locomo-user-conv-43','locomo-user-conv-44',
    'locomo-user-conv-47','locomo-user-conv-48','locomo-user-conv-49','locomo-user-conv-50'
  ]) AS user_id
)
DELETE FROM user_memories_contexts USING target_users u WHERE user_memories_contexts.user_id = u.user_id;

WITH target_users AS (
  SELECT UNNEST(ARRAY[
    'locomo-user-conv-26','locomo-user-conv-30','locomo-user-conv-41',
    'locomo-user-conv-42','locomo-user-conv-43','locomo-user-conv-44',
    'locomo-user-conv-47','locomo-user-conv-48','locomo-user-conv-49','locomo-user-conv-50'
  ]) AS user_id
)
DELETE FROM user_memories_preferences USING target_users u WHERE user_memories_preferences.user_id = u.user_id;

WITH target_users AS (
  SELECT UNNEST(ARRAY[
    'locomo-user-conv-26','locomo-user-conv-30','locomo-user-conv-41',
    'locomo-user-conv-42','locomo-user-conv-43','locomo-user-conv-44',
    'locomo-user-conv-47','locomo-user-conv-48','locomo-user-conv-49','locomo-user-conv-50'
  ]) AS user_id
)
DELETE FROM user_memories_identities USING target_users u WHERE user_memories_identities.user_id = u.user_id;

WITH target_users AS (
  SELECT UNNEST(ARRAY[
    'locomo-user-conv-26','locomo-user-conv-30','locomo-user-conv-41',
    'locomo-user-conv-42','locomo-user-conv-43','locomo-user-conv-44',
    'locomo-user-conv-47','locomo-user-conv-48','locomo-user-conv-49','locomo-user-conv-50'
  ]) AS user_id
)
DELETE FROM user_memories USING target_users u WHERE user_memories.user_id = u.user_id;
```

## 3. Run the ingest

Set the required envs and execute:

```bash
MEMORY_USER_MEMORY_LOBEHUB_BASE_URL="http://localhost:3000" \
MEMORY_USER_MEMORY_BENCHMARKS_LOCOMO_DATASETS="path/to/locomo/dataset/data/locomo10.json" \
bun run tsx lobehub/packages/memory-user-memory/benchmarks/locomo/run.ts
```

Only samples whose IDs pass the filter in `run.ts` (currently `conv-26`) will ingest; adjust the filter if you need more samples.
