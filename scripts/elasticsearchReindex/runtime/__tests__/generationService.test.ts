// @vitest-environment node
import type { FtsSearchDocumentEntity, FtsSearchReindexEntityStatus } from '@lobechat/types';
import { FTS_SEARCH_DOCUMENT_ENTITIES } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FTS_SEARCH_INDEX_ANALYSIS,
  FTS_SEARCH_INDEX_DEFINITIONS,
  getFtsSearchIndexAlias,
  getFtsSearchIndexSchemaFingerprint,
  getFtsSearchIndexSchemaVersion,
  getFtsSearchPhysicalIndexName,
} from '../../../../packages/database/src/repositories/ftsSearchDocument';
import type {
  FtsSearchSyncOutboxEntityStats,
  FtsSearchSyncOutboxStats,
} from '../../../../packages/database/src/repositories/ftsSearchSyncOutbox';
import type { FtsSearchReindexRunState } from '../checkpointRepository';
import type { FtsSearchReindexGenerationDescription } from '../elasticsearchClient';
import { parseGenerationVersion } from '../elasticsearchClient';
import type {
  FtsSearchGenerationCheckpointReader,
  FtsSearchGenerationElasticsearchClient,
} from '../generationService';
import {
  classifyMappingChange,
  describeEntityGeneration,
  planRetiredGenerations,
  promoteGeneration,
  purgeRetiredGenerations,
  resolveInPlaceTarget,
  retireGenerations,
} from '../generationService';
import { diffFtsSearchMappings } from '../mappingDiff';

const NAMESPACE = 'lobehub';
const ENTITY: FtsSearchDocumentEntity = 'topics';
const ALIAS = getFtsSearchIndexAlias(NAMESPACE, ENTITY);
const DECLARED_FINGERPRINT = getFtsSearchIndexSchemaFingerprint(ENTITY);
const IDLE_OUTBOX_ENTITY: FtsSearchSyncOutboxEntityStats = {
  dead: 0,
  expiredLeases: 0,
  inFlight: 0,
  oldestReadyAgeSeconds: 0,
  pending: 0,
  ready: 0,
  retrying: 0,
};

const createOutboxStats = (
  overrides: Partial<Record<FtsSearchDocumentEntity, Partial<FtsSearchSyncOutboxEntityStats>>> = {},
): FtsSearchSyncOutboxStats => {
  const entities = Object.fromEntries(
    FTS_SEARCH_DOCUMENT_ENTITIES.map((entity) => [
      entity,
      { ...IDLE_OUTBOX_ENTITY, ...overrides[entity] },
    ]),
  ) as Record<FtsSearchDocumentEntity, FtsSearchSyncOutboxEntityStats>;
  const totals = Object.values(entities).reduce(
    (stats, entity) => ({
      dead: stats.dead + entity.dead,
      expiredLeases: stats.expiredLeases + entity.expiredLeases,
      inFlight: stats.inFlight + entity.inFlight,
      oldestReadyAgeSeconds: Math.max(stats.oldestReadyAgeSeconds, entity.oldestReadyAgeSeconds),
      pending: stats.pending + entity.pending,
      ready: stats.ready + entity.ready,
      retrying: stats.retrying + entity.retrying,
    }),
    { ...IDLE_OUTBOX_ENTITY },
  );

  return {
    ...totals,
    entities,
    highWaterRevision: 0,
    oldestActiveRevision: null,
    revisionLag: 0,
  };
};

const IDLE_OUTBOX = createOutboxStats();

type LiveMappings = NonNullable<FtsSearchReindexGenerationDescription['mappings']>;

/** Mapping an index built from the declared definition reports back, cloned so tests can mutate it. */
const declaredMappings = (entity: FtsSearchDocumentEntity = ENTITY): LiveMappings =>
  structuredClone(FTS_SEARCH_INDEX_DEFINITIONS[entity].mappings) as unknown as LiveMappings;

const declaredAnalysis = (): Record<string, unknown> =>
  structuredClone(FTS_SEARCH_INDEX_ANALYSIS) as unknown as Record<string, unknown>;

const physicalIndex = (version: number, entity: FtsSearchDocumentEntity = ENTITY) =>
  getFtsSearchPhysicalIndexName(NAMESPACE, entity, version);

/**
 * Every entity currently declares `schemaVersion: 1`, so version-skew scenarios raise the declared
 * version at runtime. The fingerprint only hashes `mappings` plus the shared analysis, so the
 * declared fingerprint is unaffected; the global `afterEach` restores every definition.
 */
const setDeclaredVersion = (entity: FtsSearchDocumentEntity, version: number) => {
  (FTS_SEARCH_INDEX_DEFINITIONS[entity] as unknown as { schemaVersion: number }).schemaVersion =
    version;
};

const originalDeclaredVersions = FTS_SEARCH_DOCUMENT_ENTITIES.map(
  (entity) => [entity, getFtsSearchIndexSchemaVersion(entity)] as const,
);

const buildMeta = ({
  fingerprint = DECLARED_FINGERPRINT,
  reindexRunId = '00000000-0000-4000-8000-000000000001',
  version,
}: {
  fingerprint?: string | null;
  reindexRunId?: string;
  version: number;
}): NonNullable<FtsSearchReindexGenerationDescription['meta']> => ({
  reindex_run_id: reindexRunId,
  schema_version: version,
  ...(fingerprint === null ? {} : { schema_fingerprint: fingerprint }),
});

const buildGeneration = (
  index: string,
  overrides: Partial<FtsSearchReindexGenerationDescription> = {},
  entity: FtsSearchDocumentEntity = ENTITY,
): FtsSearchReindexGenerationDescription => ({
  aliased: true,
  analysis: declaredAnalysis(),
  index,
  isWriteIndex: false,
  mappings: declaredMappings(entity),
  meta: null,
  state: 'open',
  version: parseGenerationVersion(getFtsSearchIndexAlias(NAMESPACE, entity), index) ?? null,
  ...overrides,
});

/** A generation the tool built for `version` and that carries the declared fingerprint. */
const buildManagedGeneration = (
  version: number,
  overrides: Partial<FtsSearchReindexGenerationDescription> = {},
  entity: FtsSearchDocumentEntity = ENTITY,
) =>
  buildGeneration(
    physicalIndex(version, entity),
    {
      meta: buildMeta({ fingerprint: getFtsSearchIndexSchemaFingerprint(entity), version }),
      ...overrides,
    },
    entity,
  );

const createClient = (generations: FtsSearchReindexGenerationDescription[]) => ({
  closeIndex: vi.fn<FtsSearchGenerationElasticsearchClient['closeIndex']>().mockResolvedValue(),
  deleteIndex: vi.fn<FtsSearchGenerationElasticsearchClient['deleteIndex']>().mockResolvedValue(),
  describeGenerations: vi
    .fn<FtsSearchGenerationElasticsearchClient['describeGenerations']>()
    .mockResolvedValue(generations),
  ensureRetiredIndexProtection: vi
    .fn<FtsSearchGenerationElasticsearchClient['ensureRetiredIndexProtection']>()
    .mockResolvedValue(),
  promoteAlias: vi.fn<FtsSearchGenerationElasticsearchClient['promoteAlias']>().mockResolvedValue(),
});

/** Checkpoint left behind by an `--apply` run that targeted `<namespace>-<entity>-v<version>`. */
const createRunState = (
  version: number,
  status: FtsSearchReindexEntityStatus,
): FtsSearchReindexRunState => ({
  progress: FTS_SEARCH_DOCUMENT_ENTITIES.map((entity) => ({
    completedAt: status === 'completed' ? '2026-09-01T00:00:00.000Z' : null,
    cursor: null,
    entity,
    failedCount: 0,
    indexedCount: 0,
    physicalIndex: physicalIndex(version, entity),
    processedCount: 0,
    status,
  })),
  run: {
    aliasesCreatedAt: null,
    backfillHighWaterRevision: null,
    baseRevision: 10,
    captureFingerprint: 'capture-v1',
    createdAt: '2026-09-01T00:00:00.000Z',
    id: `run-v${version}`,
    namespace: NAMESPACE,
    schemaVersion: version,
    status: status === 'completed' ? 'ready_for_incremental_sync' : 'backfilling',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
});

const createCheckpointReader = (
  states: Record<number, FtsSearchReindexRunState | undefined> = {},
): FtsSearchGenerationCheckpointReader => vi.fn(async (_namespace, version) => states[version]);

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  for (const [entity, version] of originalDeclaredVersions) setDeclaredVersion(entity, version);
});

describe('classifyMappingChange', () => {
  it('treats an index built from the declared definition as identical', () => {
    expect(classifyMappingChange(ENTITY, declaredMappings(), declaredAnalysis())).toBe('identical');
  });

  it('treats a declared mapping that only adds a top-level field as additive', () => {
    const live = declaredMappings();
    delete live.properties.description;

    expect(classifyMappingChange(ENTITY, live, declaredAnalysis())).toBe('additive');
  });

  it('treats changed analysis settings as breaking', () => {
    /** An index created before the custom analyzers existed reports none of them. */
    const legacyAnalysis = { analyzer: {}, filter: {}, tokenizer: {} };

    expect(classifyMappingChange(ENTITY, declaredMappings(), legacyAnalysis)).toBe('breaking');
  });

  it('treats a changed dynamic setting as breaking', () => {
    const live = { ...declaredMappings(), dynamic: 'true' };

    expect(classifyMappingChange(ENTITY, live, declaredAnalysis())).toBe('breaking');
  });

  it('treats a live field the code no longer declares as breaking', () => {
    const live = declaredMappings();
    live.properties.legacy_field = { type: 'keyword' };

    expect(classifyMappingChange(ENTITY, live, declaredAnalysis())).toBe('breaking');
  });

  it('treats a changed analyzer on an existing field as breaking', () => {
    const live = declaredMappings();
    live.properties.title.analyzer = 'standard';

    expect(classifyMappingChange(ENTITY, live, declaredAnalysis())).toBe('breaking');
  });
});

describe('diffFtsSearchMappings', () => {
  it('reports a deterministic field-level diff with actionable reasons', () => {
    const live = declaredMappings();
    delete live.properties.description;
    live.properties.legacy_field = { type: 'keyword' };
    live.properties.title = {
      analyzer: 'standard',
      fields: { legacy: { type: 'keyword' } },
      ignore_above: 512,
      type: 'keyword',
    };

    expect(
      diffFtsSearchMappings({
        declared: declaredMappings(),
        declaredAnalysis: declaredAnalysis(),
        live,
        liveAnalysis: { analyzer: {} },
      }),
    ).toEqual({
      added: ['description'],
      analysisChanged: true,
      changed: [
        {
          field: 'title',
          reasons: ['type', 'analyzer', 'ignore_above', 'multifields'],
        },
      ],
      dynamicChanged: false,
      removed: ['legacy_field'],
    });
  });
});

describe('describeEntityGeneration', () => {
  const describeFor = (
    generations: FtsSearchReindexGenerationDescription[],
    states: Record<number, FtsSearchReindexRunState | undefined> = {},
  ) => {
    const client = createClient(generations);
    return {
      client,
      status: describeEntityGeneration({
        client,
        entity: ENTITY,
        namespace: NAMESPACE,
        readCheckpoint: createCheckpointReader(states),
      }),
    };
  };

  it('reports missing when the alias has no generation', async () => {
    const { client, status } = describeFor([]);

    await expect(status).resolves.toMatchObject({
      alias: ALIAS,
      candidates: [],
      classification: 'missing',
      declared: { fingerprint: DECLARED_FINGERPRINT, index: physicalIndex(1), version: 1 },
      live: null,
      mappingChange: null,
    });
    expect((await status).action).toContain('--fresh-run');
    expect(client.describeGenerations).toHaveBeenCalledWith(ALIAS);
  });

  it('reports unmanaged when the write index carries no reindex _meta', async () => {
    /** A hand-created index: outside the `<alias>-v<n>` scheme and without `_meta`. */
    const legacyIndex = buildGeneration(ALIAS, { isWriteIndex: true });
    const { status } = describeFor([legacyIndex]);

    await expect(status).resolves.toMatchObject({
      candidates: [],
      classification: 'unmanaged',
      live: { fingerprint: null, index: ALIAS, reindexRunId: null, version: null },
    });
    expect((await status).action).toContain('carries no reindex _meta');
  });

  it('reports in_sync when the live generation matches the declared fingerprint', async () => {
    const { status } = describeFor([buildManagedGeneration(1, { isWriteIndex: true })], {
      1: createRunState(1, 'completed'),
    });

    await expect(status).resolves.toMatchObject({
      action: 'No action',
      candidates: [],
      classification: 'in_sync',
      live: {
        backfill: 'completed',
        fingerprint: DECLARED_FINGERPRINT,
        index: physicalIndex(1),
        matchesDeclared: true,
        version: 1,
      },
      mappingChange: 'identical',
    });
  });

  it('reports drift when the live generation changed without a version bump', async () => {
    const live = buildGeneration(physicalIndex(1), {
      isWriteIndex: true,
      meta: buildMeta({ fingerprint: 'stale-fingerprint', version: 1 }),
    });
    const { status } = describeFor([live], { 1: createRunState(1, 'completed') });

    await expect(status).resolves.toMatchObject({
      classification: 'drift',
      live: { fingerprint: 'stale-fingerprint', matchesDeclared: false },
    });
    expect((await status).action).toContain('changed without a version bump');
  });

  it('reports upgrade_available and points at the completed newer generation', async () => {
    setDeclaredVersion(ENTITY, 2);
    const { status } = describeFor(
      [buildManagedGeneration(1, { isWriteIndex: true }), buildManagedGeneration(2)],
      { 1: createRunState(1, 'completed'), 2: createRunState(2, 'completed') },
    );

    await expect(status).resolves.toMatchObject({
      action: `Run --promote --entity=${ENTITY} once the Outbox is drained`,
      candidates: [
        { backfill: 'completed', index: physicalIndex(2), matchesDeclared: true, version: 2 },
      ],
      classification: 'upgrade_available',
      declared: { index: physicalIndex(2), version: 2 },
      live: { index: physicalIndex(1), matchesDeclared: false, version: 1 },
    });
  });

  it('reports rollback_required when the alias serves a newer generation than the code', async () => {
    const { status } = describeFor([buildManagedGeneration(2, { isWriteIndex: true })], {
      2: createRunState(2, 'completed'),
    });

    await expect(status).resolves.toMatchObject({
      classification: 'rollback_required',
      live: { index: physicalIndex(2), version: 2 },
    });
    expect((await status).action).toContain('--version=1');
  });

  it('accepts a legacy _meta without a fingerprint on the declared version', async () => {
    const live = buildGeneration(physicalIndex(1), {
      isWriteIndex: true,
      meta: buildMeta({ fingerprint: null, version: 1 }),
    });
    const { status } = describeFor([live], { 1: createRunState(1, 'completed') });

    await expect(status).resolves.toMatchObject({
      classification: 'in_sync',
      live: { fingerprint: null, matchesDeclared: true },
    });
  });

  it.each([
    { backfill: 'completed', name: 'a completed run', state: createRunState(1, 'completed') },
    {
      backfill: 'backfilling',
      name: 'a running backfill',
      state: createRunState(1, 'backfilling'),
    },
    { backfill: 'unknown', name: 'a discarded checkpoint', state: undefined },
  ])('summarizes the backfill of $name as $backfill', async ({ backfill, state }) => {
    const { status } = describeFor([buildManagedGeneration(1, { isWriteIndex: true })], {
      1: state,
    });

    await expect(status).resolves.toMatchObject({ live: { backfill } });
  });
});

describe('promoteGeneration', () => {
  /** The declared generation is v2 so promotion targets a generation newer than the live one. */
  beforeEach(() => setDeclaredVersion(ENTITY, 2));

  const promote = ({
    entity = ENTITY,
    generations,
    outboxStats = IDLE_OUTBOX,
    states = {},
    version,
  }: {
    entity?: FtsSearchDocumentEntity;
    generations: FtsSearchReindexGenerationDescription[];
    outboxStats?: FtsSearchSyncOutboxStats;
    states?: Record<number, FtsSearchReindexRunState | undefined>;
    version?: number;
  }) => {
    const client = createClient(generations);
    return {
      client,
      result: promoteGeneration({
        client,
        entity,
        namespace: NAMESPACE,
        outboxStats,
        readCheckpoint: createCheckpointReader(states),
        version,
      }),
    };
  };

  it('moves the alias to a fully backfilled newer generation', async () => {
    const { client, result } = promote({
      generations: [buildManagedGeneration(1, { isWriteIndex: true }), buildManagedGeneration(2)],
      states: { 1: createRunState(1, 'completed'), 2: createRunState(2, 'completed') },
    });

    await expect(result).resolves.toEqual({
      alias: ALIAS,
      from: [physicalIndex(1)],
      outcome: 'promoted',
      to: physicalIndex(2),
    });
    expect(client.promoteAlias).toHaveBeenCalledExactlyOnceWith(
      ALIAS,
      [physicalIndex(1)],
      physicalIndex(2),
    );
  });

  it('rejects when the target generation does not exist', async () => {
    const { client, result } = promote({
      generations: [buildManagedGeneration(1, { isWriteIndex: true })],
      states: { 1: createRunState(1, 'completed') },
    });

    await expect(result).rejects.toThrow(`No v2 generation exists for ${ALIAS}`);
    expect(client.promoteAlias).not.toHaveBeenCalled();
  });

  it('returns already_live without checkpoint or Outbox gates when a valid target is live', async () => {
    const { client, result } = promote({
      generations: [buildManagedGeneration(2, { isWriteIndex: true })],
      outboxStats: { ...IDLE_OUTBOX, dead: 1, pending: 2 },
    });

    await expect(result).resolves.toEqual({
      alias: ALIAS,
      from: [],
      outcome: 'already_live',
      to: physicalIndex(2),
    });
    expect(client.promoteAlias).not.toHaveBeenCalled();
  });

  it('rejects an already-live target whose backfill is still running', async () => {
    const { client, result } = promote({
      generations: [buildManagedGeneration(2, { isWriteIndex: true })],
      states: { 2: createRunState(2, 'backfilling') },
    });

    await expect(result).rejects.toThrow(`${physicalIndex(2)} backfill is incomplete`);
    expect(client.promoteAlias).not.toHaveBeenCalled();
  });

  it('rejects an already-live target whose declared mapping drifted', async () => {
    const target = buildGeneration(physicalIndex(2), {
      isWriteIndex: true,
      meta: buildMeta({ fingerprint: 'stale-fingerprint', version: 2 }),
    });
    const { client, result } = promote({ generations: [target] });

    await expect(result).rejects.toThrow(
      `${physicalIndex(2)} was not built from the declared v2 mapping`,
    );
    expect(client.promoteAlias).not.toHaveBeenCalled();
  });

  it('rejects when the target index is closed', async () => {
    const { client, result } = promote({
      generations: [
        buildManagedGeneration(1, { isWriteIndex: true }),
        buildManagedGeneration(2, { state: 'closed' }),
      ],
      states: { 1: createRunState(1, 'completed'), 2: createRunState(2, 'completed') },
    });

    await expect(result).rejects.toThrow(`${physicalIndex(2)} is closed (being retired)`);
    expect(client.promoteAlias).not.toHaveBeenCalled();
  });

  it('rejects when the target was not built from the declared mapping', async () => {
    const target = buildGeneration(physicalIndex(2), {
      meta: buildMeta({ fingerprint: 'stale-fingerprint', version: 2 }),
    });
    const { client, result } = promote({
      generations: [buildManagedGeneration(1, { isWriteIndex: true }), target],
      states: { 1: createRunState(1, 'completed'), 2: createRunState(2, 'completed') },
    });

    await expect(result).rejects.toThrow(
      `${physicalIndex(2)} was not built from the declared v2 mapping`,
    );
    expect(client.promoteAlias).not.toHaveBeenCalled();
  });

  it('rejects when the target backfill is still running', async () => {
    const { client, result } = promote({
      generations: [buildManagedGeneration(1, { isWriteIndex: true }), buildManagedGeneration(2)],
      states: { 1: createRunState(1, 'completed'), 2: createRunState(2, 'backfilling') },
    });

    await expect(result).rejects.toThrow(`${physicalIndex(2)} backfill is incomplete`);
    expect(client.promoteAlias).not.toHaveBeenCalled();
  });

  it('rejects when no checkpoint proves the target finished its backfill', async () => {
    const { client, result } = promote({
      generations: [buildManagedGeneration(1, { isWriteIndex: true }), buildManagedGeneration(2)],
      states: { 1: createRunState(1, 'completed') },
    });

    await expect(result).rejects.toThrow(
      `No checkpoint proves ${physicalIndex(2)} finished its backfill`,
    );
    expect(client.promoteAlias).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'pending rows', stats: { pending: 3 } },
    { name: 'leased rows', stats: { inFlight: 1 } },
    { name: 'dead rows', stats: { dead: 2 } },
  ])('rejects when the target entity Outbox still has $name', async ({ stats }) => {
    const entity = 'messages';
    setDeclaredVersion(entity, 2);
    const { client, result } = promote({
      entity,
      generations: [
        buildManagedGeneration(1, { isWriteIndex: true }, entity),
        buildManagedGeneration(2, {}, entity),
      ],
      outboxStats: createOutboxStats({ [entity]: stats }),
      states: { 1: createRunState(1, 'completed'), 2: createRunState(2, 'completed') },
    });

    await expect(result).rejects.toThrow('Outbox is not idle');
    expect(client.promoteAlias).not.toHaveBeenCalled();
  });

  it('ignores pending and dead Outbox rows owned by another entity', async () => {
    const entity = 'messages';
    setDeclaredVersion(entity, 2);
    const { client, result } = promote({
      entity,
      generations: [
        buildManagedGeneration(1, { isWriteIndex: true }, entity),
        buildManagedGeneration(2, {}, entity),
      ],
      outboxStats: createOutboxStats({ agents: { dead: 2, pending: 3 } }),
      states: { 1: createRunState(1, 'completed'), 2: createRunState(2, 'completed') },
    });

    await expect(result).resolves.toMatchObject({ outcome: 'promoted' });
    expect(client.promoteAlias).toHaveBeenCalledExactlyOnceWith(
      getFtsSearchIndexAlias(NAMESPACE, entity),
      [physicalIndex(1, entity)],
      physicalIndex(2, entity),
    );
  });

  it('rolls back to an older generation that carries reindex _meta', async () => {
    /** The previous generation predates the declared fingerprint and has no checkpoint left. */
    const previous = buildGeneration(physicalIndex(1), {
      meta: buildMeta({ fingerprint: 'legacy-fingerprint', reindexRunId: 'run-v1', version: 1 }),
    });
    const { client, result } = promote({
      generations: [previous, buildManagedGeneration(2, { isWriteIndex: true })],
      states: { 2: createRunState(2, 'completed') },
      version: 1,
    });

    await expect(result).resolves.toEqual({
      alias: ALIAS,
      from: [physicalIndex(2)],
      outcome: 'promoted',
      to: physicalIndex(1),
    });
    expect(client.promoteAlias).toHaveBeenCalledExactlyOnceWith(
      ALIAS,
      [physicalIndex(2)],
      physicalIndex(1),
    );
  });

  it('rejects a rollback target without reindex _meta', async () => {
    const { client, result } = promote({
      generations: [
        buildGeneration(physicalIndex(1)),
        buildManagedGeneration(2, { isWriteIndex: true }),
      ],
      states: { 2: createRunState(2, 'completed') },
      version: 1,
    });

    await expect(result).rejects.toThrow(
      `${physicalIndex(1)} has no checkpoint and no reindex _meta`,
    );
    expect(client.promoteAlias).not.toHaveBeenCalled();
  });

  it('rejects a rollback target that requires a source field the current projection removed', async () => {
    const previousMappings = declaredMappings();
    previousMappings.properties.legacy_title = { type: 'text' };
    const previous = buildGeneration(physicalIndex(1), {
      mappings: previousMappings,
      meta: buildMeta({ fingerprint: 'legacy-fingerprint', reindexRunId: 'run-v1', version: 1 }),
    });
    const { client, result } = promote({
      generations: [previous, buildManagedGeneration(2, { isWriteIndex: true })],
      states: { 2: createRunState(2, 'completed') },
      version: 1,
    });

    await expect(result).rejects.toThrow(
      `${physicalIndex(1)} requires source fields the current projection cannot preserve: legacy_title (missing)`,
    );
    expect(client.promoteAlias).not.toHaveBeenCalled();
  });
});

describe('retireGenerations', () => {
  const retire = ({
    generations,
    states = {},
  }: {
    generations: FtsSearchReindexGenerationDescription[];
    states?: Record<number, FtsSearchReindexRunState | undefined>;
  }) => {
    const client = createClient(generations);
    return {
      client,
      result: retireGenerations({
        client,
        entity: ENTITY,
        namespace: NAMESPACE,
        readCheckpoint: createCheckpointReader(states),
      }),
    };
  };

  it('rejects when the alias has no live generation', async () => {
    const { client, result } = retire({ generations: [] });

    await expect(result).rejects.toThrow(`${ALIAS} has no live generation`);
    expect(client.closeIndex).not.toHaveBeenCalled();
    expect(client.deleteIndex).not.toHaveBeenCalled();
  });

  it('rejects when the live generation is not in sync', async () => {
    setDeclaredVersion(ENTITY, 2);
    const { client, result } = retire({
      generations: [buildManagedGeneration(1, { isWriteIndex: true }), buildManagedGeneration(2)],
      states: { 1: createRunState(1, 'completed'), 2: createRunState(2, 'completed') },
    });

    await expect(result).rejects.toThrow(`${ALIAS} is upgrade_available; retire only after`);
    expect(client.closeIndex).not.toHaveBeenCalled();
    expect(client.deleteIndex).not.toHaveBeenCalled();
  });

  it('closes open generations and leaves already closed ones for explicit purge', async () => {
    setDeclaredVersion(ENTITY, 3);
    const { client, result } = retire({
      generations: [
        buildManagedGeneration(1, { aliased: false, state: 'open' }),
        buildManagedGeneration(2, { aliased: false, state: 'closed' }),
        buildManagedGeneration(3, { isWriteIndex: true }),
      ],
      states: { 3: createRunState(3, 'completed') },
    });

    await expect(result).resolves.toEqual({
      alreadyClosed: [physicalIndex(2)],
      alias: ALIAS,
      closed: [physicalIndex(1)],
      deleted: [],
      kept: physicalIndex(3),
    });
    expect(client.closeIndex).toHaveBeenCalledExactlyOnceWith(physicalIndex(1));
    expect(client.deleteIndex).not.toHaveBeenCalled();
  });

  it.each(['open', 'closed'] as const)(
    'preserves an alias-attached generation in the %s state alongside the write index',
    async (state) => {
      setDeclaredVersion(ENTITY, 2);
      const { client, result } = retire({
        generations: [
          buildManagedGeneration(1, { aliased: true, state }),
          buildManagedGeneration(2, { isWriteIndex: true }),
        ],
      });

      await expect(result).resolves.toEqual({
        alreadyClosed: [],
        alias: ALIAS,
        closed: [],
        deleted: [],
        kept: physicalIndex(2),
      });
      expect(client.closeIndex).not.toHaveBeenCalled();
      expect(client.deleteIndex).not.toHaveBeenCalled();
    },
  );

  it('preserves both alias targets when the description marks both as writable', async () => {
    const { client, result } = retire({
      generations: [
        buildManagedGeneration(1, { isWriteIndex: true }),
        buildManagedGeneration(2, { isWriteIndex: true }),
      ],
    });

    await expect(result).resolves.toEqual({
      alreadyClosed: [],
      alias: ALIAS,
      closed: [],
      deleted: [],
      kept: physicalIndex(1),
    });
    expect(client.closeIndex).not.toHaveBeenCalled();
    expect(client.deleteIndex).not.toHaveBeenCalled();
  });
});

describe('purgeRetiredGenerations', () => {
  it('deletes only closed, detached, managed generations after installing deletion protection', async () => {
    setDeclaredVersion(ENTITY, 3);
    const unmanaged = buildGeneration(physicalIndex(0), { aliased: false, state: 'closed' });
    const client = createClient([
      unmanaged,
      buildManagedGeneration(1, { aliased: false, state: 'open' }),
      buildManagedGeneration(2, { aliased: false, state: 'closed' }),
      buildManagedGeneration(3, { isWriteIndex: true }),
    ]);

    await expect(
      purgeRetiredGenerations({
        client,
        entity: ENTITY,
        namespace: NAMESPACE,
        readCheckpoint: createCheckpointReader({ 3: createRunState(3, 'completed') }),
      }),
    ).resolves.toEqual({ alias: ALIAS, deleted: [physicalIndex(2)], kept: physicalIndex(3) });
    expect(client.ensureRetiredIndexProtection).toHaveBeenCalledExactlyOnceWith(physicalIndex(2));
    expect(client.deleteIndex).toHaveBeenCalledExactlyOnceWith(physicalIndex(2));
  });

  it('rejects deletion while the retired generation checkpoint is still backfilling', async () => {
    setDeclaredVersion(ENTITY, 2);
    const client = createClient([
      buildManagedGeneration(1, { aliased: false, state: 'closed' }),
      buildManagedGeneration(2, { isWriteIndex: true }),
    ]);

    await expect(
      purgeRetiredGenerations({
        client,
        entity: ENTITY,
        namespace: NAMESPACE,
        readCheckpoint: createCheckpointReader({
          1: createRunState(1, 'backfilling'),
          2: createRunState(2, 'completed'),
        }),
      }),
    ).rejects.toThrow(`${physicalIndex(1)} backfill is still running`);
    expect(client.ensureRetiredIndexProtection).not.toHaveBeenCalled();
    expect(client.deleteIndex).not.toHaveBeenCalled();
  });
});

describe('planRetiredGenerations', () => {
  it('previews close and purge work with explicit blockers and no side effects', async () => {
    setDeclaredVersion(ENTITY, 3);
    const unmanaged = buildGeneration(physicalIndex(0), { aliased: false, state: 'closed' });
    const client = createClient([
      unmanaged,
      buildManagedGeneration(1, { aliased: false, state: 'open' }),
      buildManagedGeneration(2, { aliased: false, state: 'closed' }),
      buildManagedGeneration(3, { isWriteIndex: true }),
      buildManagedGeneration(4, { aliased: false, state: 'open' }),
    ]);
    const status = await describeEntityGeneration({
      client,
      entity: ENTITY,
      namespace: NAMESPACE,
      readCheckpoint: createCheckpointReader({ 3: createRunState(3, 'completed') }),
    });

    expect(planRetiredGenerations(status)).toEqual({
      alreadyClosed: [physicalIndex(2)],
      blockedBy: [
        `${physicalIndex(0)} has no known managed reindex identity`,
        `${physicalIndex(4)} is not older than the live generation`,
      ],
      close: [physicalIndex(1)],
      purgeCandidates: [physicalIndex(2)],
    });
    expect(client.closeIndex).not.toHaveBeenCalled();
    expect(client.deleteIndex).not.toHaveBeenCalled();
  });

  it('does not close an older generation while its checkpoint is backfilling', async () => {
    setDeclaredVersion(ENTITY, 2);
    const client = createClient([
      buildManagedGeneration(1, { aliased: false, state: 'open' }),
      buildManagedGeneration(2, { isWriteIndex: true }),
    ]);
    const status = await describeEntityGeneration({
      client,
      entity: ENTITY,
      namespace: NAMESPACE,
      readCheckpoint: createCheckpointReader({
        1: createRunState(1, 'backfilling'),
        2: createRunState(2, 'completed'),
      }),
    });

    expect(planRetiredGenerations(status)).toMatchObject({
      blockedBy: [`${physicalIndex(1)} backfill is still running`],
      close: [],
    });
  });
});

describe('resolveInPlaceTarget', () => {
  it('uses the live index for a normal additive version upgrade', async () => {
    setDeclaredVersion(ENTITY, 2);
    const mappings = declaredMappings();
    delete mappings.properties.title;
    const client = createClient([buildManagedGeneration(1, { isWriteIndex: true, mappings })]);
    const status = await describeEntityGeneration({
      client,
      entity: ENTITY,
      namespace: NAMESPACE,
      readCheckpoint: createCheckpointReader(),
    });

    expect(status).toMatchObject({
      classification: 'upgrade_available',
      mappingChange: 'additive',
    });
    expect(resolveInPlaceTarget(status)).toBe(physicalIndex(1));
  });

  it('rejects a normal breaking version upgrade', async () => {
    setDeclaredVersion(ENTITY, 2);
    const mappings = declaredMappings();
    mappings.properties.title.type = 'keyword';
    const client = createClient([buildManagedGeneration(1, { isWriteIndex: true, mappings })]);
    const status = await describeEntityGeneration({
      client,
      entity: ENTITY,
      namespace: NAMESPACE,
      readCheckpoint: createCheckpointReader(),
    });

    expect(status).toMatchObject({
      classification: 'upgrade_available',
      mappingChange: 'breaking',
    });
    expect(() => resolveInPlaceTarget(status)).toThrow('cannot be upgraded in place');
  });

  it('resumes the crash window after restamping and before checkpoint creation', async () => {
    setDeclaredVersion(ENTITY, 2);
    const client = createClient([
      buildManagedGeneration(2, { index: physicalIndex(1), isWriteIndex: true }),
    ]);
    const status = await describeEntityGeneration({
      client,
      entity: ENTITY,
      namespace: NAMESPACE,
      readCheckpoint: createCheckpointReader(),
    });

    expect(resolveInPlaceTarget(status)).toBe(physicalIndex(1));
  });

  it('rejects a same-version live index with real physical mapping drift', async () => {
    setDeclaredVersion(ENTITY, 2);
    const mappings = declaredMappings();
    mappings.properties.title.analyzer = 'standard';
    const client = createClient([
      buildManagedGeneration(2, {
        index: physicalIndex(1),
        isWriteIndex: true,
        mappings,
      }),
    ]);
    const status = await describeEntityGeneration({
      client,
      entity: ENTITY,
      namespace: NAMESPACE,
      readCheckpoint: createCheckpointReader(),
    });

    expect(() => resolveInPlaceTarget(status)).toThrow('physical mapping differs');
  });
});
