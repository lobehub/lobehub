// @vitest-environment node
import type { FtsSearchDocumentEntity } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { FtsSearchEntityGenerationStatus } from '../runtime/generationService';
import { runFtsSearchStartupMigration } from '../startupCoordinator';

const status = (
  entity: FtsSearchDocumentEntity,
  classification: FtsSearchEntityGenerationStatus['classification'],
  options: {
    backfill?: 'backfilling' | 'completed' | 'unknown';
    candidate?: boolean;
    candidateCompatible?: boolean;
    inPlace?: boolean;
    version?: number;
  } = {},
): FtsSearchEntityGenerationStatus => {
  const version = options.version ?? 1;
  const index = `test-${entity}-v${version}`;
  const generation = {
    aliased: true,
    backfill: options.backfill ?? 'completed',
    fieldCompatibility: { compatible: true, incompatibleFields: [], missingFields: [] },
    fingerprint: 'fingerprint',
    index: options.inPlace ? `test-${entity}-v0` : index,
    matchesDeclared: true,
    reindexRunId: 'run-id',
    state: 'open' as const,
    version,
  };
  return {
    action: 'repair manually',
    alias: `test-${entity}`,
    candidates: options.candidate
      ? [
          {
            ...generation,
            aliased: false,
            fieldCompatibility:
              options.candidateCompatible === false
                ? {
                    compatible: false,
                    incompatibleFields: [],
                    missingFields: ['legacy_field'],
                  }
                : generation.fieldCompatibility,
          },
        ]
      : [],
    classification,
    declared: { fingerprint: 'fingerprint', index, version },
    entity,
    live: classification === 'missing' ? null : generation,
    mappingChange: classification === 'missing' ? null : 'identical',
    mappingDiff: null,
  };
};

const setup = (initial: FtsSearchEntityGenerationStatus, checkpoint = false) => {
  let current = initial;
  const applyGeneration = vi.fn(async () => {
    current = status(initial.entity, 'in_sync');
  });
  const promoteEntity = vi.fn(async () => {
    current = status(initial.entity, 'in_sync');
  });
  const drainIncrementalSync = vi.fn(async () => ({ hasMore: false }));
  const run = () =>
    runFtsSearchStartupMigration({
      applyGeneration,
      describeEntity: async () => current,
      drainIncrementalSync,
      generations: [{ entities: [initial.entity], schemaVersion: 1 }],
      promoteEntity,
      readCheckpointEntities: async () => (checkpoint ? [initial.entity] : undefined),
      readOutboxStats: async () => ({ dead: 0, inFlight: 0, pending: 0, retrying: 0 }),
    });
  return { applyGeneration, drainIncrementalSync, promoteEntity, run };
};

describe('startup reindex coordinator', () => {
  it('automatically treats a wholly empty generation as fresh', async () => {
    const fixture = setup(status('messages', 'missing'));
    await fixture.run();
    expect(fixture.applyGeneration).toHaveBeenCalledWith({
      freshRun: true,
      generationEntities: ['messages'],
      processEntities: ['messages'],
      schemaVersion: 1,
    });
    expect(fixture.promoteEntity).toHaveBeenCalledWith('messages');
  });

  it('skips a current rebuilt generation even when its old checkpoint is absent', async () => {
    const fixture = setup(status('messages', 'in_sync', { backfill: 'unknown' }));
    await fixture.run();
    expect(fixture.applyGeneration).not.toHaveBeenCalled();
    expect(fixture.promoteEntity).not.toHaveBeenCalled();
    expect(fixture.drainIncrementalSync).toHaveBeenCalledOnce();
  });

  it('resumes an incomplete checkpoint before promotion', async () => {
    const fixture = setup(status('messages', 'in_sync', { backfill: 'backfilling' }), true);
    await fixture.run();
    expect(fixture.applyGeneration).toHaveBeenCalledWith({
      freshRun: false,
      generationEntities: ['messages'],
      processEntities: ['messages'],
      schemaVersion: 1,
    });
    expect(fixture.promoteEntity).toHaveBeenCalledWith('messages');
  });

  it('rejects a possibly incomplete in-place generation without its checkpoint', async () => {
    const fixture = setup(status('messages', 'in_sync', { backfill: 'unknown', inPlace: true }));
    await expect(fixture.run()).rejects.toThrow('no checkpoint proves');
    expect(fixture.drainIncrementalSync).not.toHaveBeenCalled();
  });

  it('does not adopt an uncheckpointed detached declared generation', async () => {
    const fixture = setup(status('messages', 'upgrade_available', { candidate: true }));
    await expect(fixture.run()).rejects.toThrow('no checkpoint proves');
    expect(fixture.applyGeneration).not.toHaveBeenCalled();
  });

  it('rejects an incompatible open non-live generation before sync can write to it', async () => {
    const fixture = setup(
      status('messages', 'upgrade_available', {
        candidate: true,
        candidateCompatible: false,
      }),
      true,
    );
    await expect(fixture.run()).rejects.toThrow(
      'incompatible with the current document projection',
    );
    expect(fixture.applyGeneration).not.toHaveBeenCalled();
    expect(fixture.drainIncrementalSync).not.toHaveBeenCalled();
  });

  it('fails when the bounded incremental drain cannot catch up', async () => {
    const fixture = setup(status('messages', 'in_sync'));
    fixture.drainIncrementalSync.mockResolvedValue({ hasMore: true });
    await expect(fixture.run()).rejects.toThrow('exceeded its incremental sync drain bound');
  });

  it('starts an uncheckpointed shared-version upgrade with only the changed entity', async () => {
    const statuses = new Map<FtsSearchDocumentEntity, FtsSearchEntityGenerationStatus>([
      ['agents', status('agents', 'in_sync', { backfill: 'unknown' })],
      ['messages', status('messages', 'upgrade_available')],
    ]);
    let checkpointExists = false;
    const applyGeneration = vi.fn(async () => {
      checkpointExists = true;
      statuses.set('messages', status('messages', 'in_sync'));
    });
    const options: Parameters<typeof runFtsSearchStartupMigration>[0] = {
      applyGeneration,
      describeEntity: async (entity: FtsSearchDocumentEntity) => statuses.get(entity)!,
      drainIncrementalSync: async () => ({ hasMore: false }),
      generations: [{ entities: ['agents', 'messages'], schemaVersion: 1 }],
      promoteEntity: async (entity: FtsSearchDocumentEntity) => {
        statuses.set(entity, status(entity, 'in_sync'));
      },
      readCheckpointEntities: async () => (checkpointExists ? ['messages'] : undefined),
      readOutboxStats: async () => ({ dead: 0, inFlight: 0, pending: 0, retrying: 0 }),
    };

    await runFtsSearchStartupMigration(options);
    expect(applyGeneration).toHaveBeenCalledWith({
      freshRun: false,
      generationEntities: ['messages'],
      processEntities: ['messages'],
      schemaVersion: 1,
    });

    applyGeneration.mockClear();
    await runFtsSearchStartupMigration(options);
    expect(applyGeneration).not.toHaveBeenCalled();
  });

  it('starts a missing shared-version entity fresh without adding its current neighbor', async () => {
    const statuses = new Map<FtsSearchDocumentEntity, FtsSearchEntityGenerationStatus>([
      ['agents', status('agents', 'in_sync', { backfill: 'unknown' })],
      ['messages', status('messages', 'missing')],
    ]);
    const applyGeneration = vi.fn(async () => {
      statuses.set('messages', status('messages', 'in_sync'));
    });

    await runFtsSearchStartupMigration({
      applyGeneration,
      describeEntity: async (entity) => statuses.get(entity)!,
      drainIncrementalSync: async () => ({ hasMore: false }),
      generations: [
        { entities: ['agents', 'messages'] as FtsSearchDocumentEntity[], schemaVersion: 1 },
      ],
      promoteEntity: async () => {},
      readCheckpointEntities: async () => undefined,
      readOutboxStats: async () => ({ dead: 0, inFlight: 0, pending: 0, retrying: 0 }),
    });

    expect(applyGeneration).toHaveBeenCalledWith({
      freshRun: true,
      generationEntities: ['messages'],
      processEntities: ['messages'],
      schemaVersion: 1,
    });
  });

  it('drops checkpoint members that moved to another schema generation', async () => {
    const statuses = new Map<FtsSearchDocumentEntity, FtsSearchEntityGenerationStatus>([
      ['agents', status('agents', 'in_sync')],
      ['messages', status('messages', 'in_sync', { version: 2 })],
      ['topics', status('topics', 'missing')],
    ]);
    const applyGeneration = vi.fn(async ({ schemaVersion }: { schemaVersion: number }) => {
      if (schemaVersion === 1) statuses.set('topics', status('topics', 'in_sync'));
    });

    await runFtsSearchStartupMigration({
      applyGeneration,
      describeEntity: async (entity) => statuses.get(entity)!,
      drainIncrementalSync: async () => ({ hasMore: false }),
      generations: [
        { entities: ['agents', 'topics'], schemaVersion: 1 },
        { entities: ['messages'], schemaVersion: 2 },
      ],
      promoteEntity: async () => {},
      readCheckpointEntities: async (schemaVersion) =>
        schemaVersion === 1 ? ['agents', 'messages'] : undefined,
      readOutboxStats: async () => ({ dead: 0, inFlight: 0, pending: 0, retrying: 0 }),
    });

    expect(applyGeneration).toHaveBeenCalledExactlyOnceWith({
      freshRun: false,
      generationEntities: ['agents', 'topics'],
      processEntities: ['topics'],
      schemaVersion: 1,
    });
  });
});
