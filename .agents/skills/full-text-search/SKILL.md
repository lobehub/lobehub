---
name: full-text-search
description: 'LobeHub product full-text search architecture and operations. Use for FtsSearchRepo, pg_search or Elasticsearch providers, search projections and mappings, reindexing, Outbox capture/sync, provider switching, search analytics, or search performance. Not for agent web-browsing tools.'
---

# Product Full-Text Search

This skill covers search over LobeHub-owned product data such as agents, topics, messages, files,
knowledge bases, documents, chat groups, and memories. It does not cover the agent's external web
search providers under `apps/server/src/services/search/` or builtin web-browsing tools.

## Architecture

Product reads follow one stable path:

```text
router/service -> createFtsSearchRepo -> FtsSearchRepo -> selected backend -> existing result schema
```

- `apps/server/src/services/ftsSearch/` owns request-scoped provider selection, Elasticsearch
  configuration, its HTTP client, and backend telemetry. Routers and domain services must call
  `createFtsSearchRepo`; they must not construct providers themselves.
- `packages/database/src/repositories/ftsSearch/` owns the provider-neutral contract and the concrete
  PostgreSQL and Elasticsearch implementations. Keep public result shapes stable in `FtsSearchRepo`.
- `packages/types/src/ftsSearch.ts` owns the shared searchable-entity list and search domain types.
- `packages/database/src/repositories/ftsSearchDocument/` owns Elasticsearch document schemas,
  mappings, queryable fields, and source-to-document projection.
- `packages/database/src/schemas/ftsSearchSyncOutbox.ts` and
  `packages/database/src/repositories/ftsSearchSyncOutbox/` own durable change capture, claims,
  retries, dead letters, leases, revision fences, and capture-definition validation.
- `scripts/elasticsearchReindex/` owns the resumable full-backfill command and its operational
  runtime. Shared database source queries and document construction remain in
  `packages/database/src/repositories/ftsSearchDocument/`. `apps/server/src/services/ftsSearchSync/` and
  `scripts/elasticsearchSync/` own continuous incremental draining.
- `packages/env/src/ftsSearch.ts` owns generic Elasticsearch environment variables.

## Provider and Permission Invariants

- `FTS_SEARCH_PROVIDER` is a deployment-level provider selector with current values `pg_search` and
  `elasticsearch`. It is not a feature flag or a user rollout. Add another enum value only when its
  provider is implemented end to end.
- Elasticsearch errors, missing configuration, and unsupported candidate behavior must remain
  visible. Never silently retry through PostgreSQL or add an `ilike` fallback.
- Before selecting Elasticsearch, require coverage tests proving that it supports every entity in
  the provider-neutral backend contract. Do not add per-entity routing between providers.
- Preserve `userId`, `workspaceId`, and caller-agent visibility throughout every provider. Candidate
  retrieval must not broaden the caller's scope.
- Where Elasticsearch only supplies candidate IDs, PostgreSQL hydration and parent checks remain
  the authoritative permission boundary. Do not return raw Elasticsearch hits directly when the
  existing result path requires database authorization or hydration.
- Provider implementations return the existing hydrated response types and ordering contract. Do
  not make routers understand provider-specific result shapes.

## Changing a Searchable Entity

Treat an entity addition or projection change as one cross-layer change. Inspect and update every
applicable item:

1. `FTS_SEARCH_DOCUMENT_ENTITIES` and shared request/result types.
2. Search document schema, mapping, text fields, filters, fixtures, and mapping parity tests.
3. `FtsSearchDocumentBuilder`, including soft deletion and fanout from related source rows.
4. PostgreSQL and Elasticsearch backend behavior, permission hydration, pagination, and ranking.
5. Capture functions/triggers or fanout queries in `captureInfrastructure.ts`.
6. Reindex checkpoints, Outbox draining, metrics, and self-host documentation.

Schema fields, mappings, builders, and fixed fixtures must agree exactly. A field that is not in the
document schema must not appear in the mapping or query field list.

Elasticsearch `multi_match` query length is bounded by a shared leaf-clause budget divided by the
selected query-field count. Adding a field reduces that entity's safe query length, and changing a
query analyzer to emit multiple terms per Unicode code point requires revisiting the budget and its
field-count regression tests.

## Capture, Reindex, and Sync

- Regular database migrations own durable schema: the revision sequence, Outbox table and indexes,
  and schema-managed source indexes such as the Memory fanout GIN index.
- Capture functions and triggers are installed only when an operator explicitly enables the
  Elasticsearch path. `installCaptureInfrastructure()` is transactional, definition-checked,
  idempotent for an exact installation, and fail-closed for partial or altered definitions.
- Do not install capture for every PostgreSQL-only instance. Do not move a normal schema index into
  the runtime installer merely because it supports capture.
- The Outbox coalesces by `(entity, document_id)`. A newer capture resets retry/dead-letter state and
  allocates a new revision only after locking the conflicting row, preserving same-document commit
  order.
- Sequence allocation is non-transactional. Use the existing write fences and committed revision
  boundary; never treat `last_value` alone as proof that all earlier Outbox rows are visible.
- Claims use the precise lease timestamp as a fencing token. A stale worker must not acknowledge,
  fail, or release work reclaimed by another worker.
- Permanent failures and exhausted retries become durable dead letters. A drain that creates or
  observes dead work must fail instead of continuing to publish a successful cutover signal.
- Full backfill does not replace continuous sync and does not switch product traffic. Keep the
  application on PostgreSQL until aliases are ready and the Outbox is empty and stable, then switch
  explicitly.

The supported operator entrypoints are:

```bash
bun run db:install-fts-search-capture
bun run fts-search:reindex -- --status
bun run fts-search:reindex -- --apply --yes
bun run fts-search:sync -- --max-steps=8 --yes
bun run scripts/pgSearchCleanup/index.ts --status
bun run scripts/pgSearchCleanup/index.ts --apply --yes
```

Read `docs/self-hosting/advanced/elasticsearch-migration.mdx` or its Chinese counterpart before
changing the operational sequence. When database rollout or index cost affects the design, also
use the `db-migrations` skill and measure the relevant operation on the actual Dev database before
adding manual or deferred release steps.

## Observability and Product Analytics

- Server provider metrics and traces live in `apps/server/src/services/ftsSearch/observability.ts`.
  Keep labels bounded: entity, provider, operation, outcome, and coarse error type are acceptable;
  raw queries, user IDs, document IDs, and index contents are not.
- User-perceived search behavior lives with the open-source Command Menu in
  `src/features/CommandMenu/analytics.ts`. Product analytics may cover end-to-end duration, rendered
  result counts, empty results, result clicks, and abandonment without a Cloud business slot.
- Measurement or analytics failures must never alter the selected provider's result or error.
- Backend metrics explain provider cost and latency; frontend events explain what the user actually
  experienced. Do not substitute one for the other.

## Validation

- Add or update focused tests beside every changed provider, mapping, builder, capture, sync, or
  analytics module.
- Preserve boundary tests proving callers use `FtsSearchRepo`, providers cannot leak raw result shapes,
  and telemetry failures do not affect search behavior.
- Test pagination after authorization drops candidates, delete/scope-change priority, concurrent
  Outbox claims and stale settlements, retry/dead-letter behavior, reindex resume identity, and
  capture-definition mismatch whenever those paths change.
- Run `bun run check <changed-files...>` from the repository root. For migration or database-runtime
  changes, follow the `db-migrations` and `testing` skills and verify against the actual Dev database.
