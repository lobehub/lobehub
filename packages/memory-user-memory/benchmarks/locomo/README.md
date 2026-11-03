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

The memory webhooks are privileged server-to-server endpoints for trusted operators and benchmark tooling. They require configured authentication headers; a browser login session does not authenticate these requests.

Before starting the LobeHub server, set the following in its environment. Replace `YOUR_RANDOM_SHARED_SECRET` with a randomly generated secret (for example, the output of `openssl rand -hex 32`):

```bash
export MEMORY_USER_MEMORY_WEBHOOK_HEADERS="x-memory-secret=YOUR_RANDOM_SHARED_SECRET"
```

Restart the server after changing its environment. Then set the same header value for the ingestor, together with the service URL and dataset path:

```bash
MEMORY_USER_MEMORY_LOBEHUB_BASE_URL="http://localhost:3000" \
MEMORY_USER_MEMORY_BENCHMARKS_LOCOMO_DATASETS="path/to/locomo/dataset/data/locomo10.json" \
MEMORY_USER_MEMORY_WEBHOOK_HEADERS="x-memory-secret=YOUR_RANDOM_SHARED_SECRET" \
bun run tsx lobehub/packages/memory-user-memory/benchmarks/locomo/run.ts
```

`MEMORY_USER_MEMORY_WEBHOOK_HEADERS` accepts comma-separated `header=value` pairs. The ingestor sends these headers with each request, and every header configured on the server must match. Setting this variable only on the ingestor does not configure the server.

- **HTTP 503:** server-side authentication headers are unset, empty, or parse to no valid pairs. Configure them on the LobeHub server.
- **HTTP 403:** a required request header is missing or incorrect. Check that the ingestor and server use matching values.

Only samples whose IDs pass the filter in `run.ts` (currently `conv-26`) will ingest; adjust the filter if you need more samples.
