// @vitest-environment node
import { FTS_SEARCH_DOCUMENT_ENTITIES } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  FTS_SEARCH_INDEX_SCHEMA_VERSION,
  getFtsSearchIndexAlias,
  getFtsSearchPhysicalIndexName,
} from '../../../../packages/database/src/repositories/ftsSearchDocument';
import type { FtsSearchSchemaDetectionClient } from '../schemaUpgrade';
import {
  detectFtsSearchIndexSchemaState,
  planFtsSearchIndexSchemaUpgrade,
  reconcileCompletedBackfillCheckpoint,
} from '../schemaUpgrade';

const namespace = 'test';

const createClient = (
  targets: Partial<Record<(typeof FTS_SEARCH_DOCUMENT_ENTITIES)[number], string>>,
): FtsSearchSchemaDetectionClient => ({
  resolveAliasTarget: async (alias) => {
    const entity = FTS_SEARCH_DOCUMENT_ENTITIES.find(
      (candidate) => getFtsSearchIndexAlias(namespace, candidate) === alias,
    );
    if (!entity) return null;
    return targets[entity] ?? null;
  },
});

const versionedTargets = (version: number) =>
  Object.fromEntries(
    FTS_SEARCH_DOCUMENT_ENTITIES.map((entity) => [
      entity,
      getFtsSearchPhysicalIndexName(namespace, entity, version),
    ]),
  );

describe('detectFtsSearchIndexSchemaState', () => {
  it('reports missing when no aliases exist yet', async () => {
    const client = createClient({});

    await expect(detectFtsSearchIndexSchemaState(client, namespace)).resolves.toEqual({
      type: 'missing',
    });
  });

  it('reports the shared version when every entity resolves to the same schema version', async () => {
    const client = createClient(versionedTargets(1));

    const state = await detectFtsSearchIndexSchemaState(client, namespace);

    expect(state).toMatchObject({ type: 'versioned', version: 1 });
  });

  it('reports mixed when versions differ across entities', async () => {
    const targets = versionedTargets(1);
    targets.agents = getFtsSearchPhysicalIndexName(namespace, 'agents', 2);
    const client = createClient(targets);

    const state = await detectFtsSearchIndexSchemaState(client, namespace);

    expect(state.type).toBe('mixed');
  });

  it('reports mixed when some entities have no alias yet', async () => {
    const targets = versionedTargets(1);
    delete targets.agents;
    const client = createClient(targets);

    const state = await detectFtsSearchIndexSchemaState(client, namespace);

    expect(state.type).toBe('mixed');
  });

  it('reports mixed when an alias points to a foreign index name', async () => {
    const targets = versionedTargets(1);
    targets.agents = 'unrelated-index-name';
    const client = createClient(targets);

    const state = await detectFtsSearchIndexSchemaState(client, namespace);

    expect(state.type).toBe('mixed');
  });
});

describe('planFtsSearchIndexSchemaUpgrade', () => {
  it('reports up_to_date when the served version matches the target', () => {
    const plan = planFtsSearchIndexSchemaUpgrade(
      { indices: {}, type: 'versioned', version: FTS_SEARCH_INDEX_SCHEMA_VERSION },
      FTS_SEARCH_INDEX_SCHEMA_VERSION,
    );

    expect(plan).toEqual({ type: 'up_to_date', version: FTS_SEARCH_INDEX_SCHEMA_VERSION });
  });

  it('plans a copy upgrade from version 1 to version 2', () => {
    const plan = planFtsSearchIndexSchemaUpgrade({ indices: {}, type: 'versioned', version: 1 }, 2);

    expect(plan).toEqual({ fromVersion: 1, strategy: 'copy', toVersion: 2, type: 'upgrade' });
  });

  it('throws when no stable aliases exist yet', () => {
    expect(() => planFtsSearchIndexSchemaUpgrade({ type: 'missing' })).toThrow(
      '--apply --fresh-run --yes',
    );
  });

  it('throws when stable aliases serve mixed schema versions', () => {
    expect(() =>
      planFtsSearchIndexSchemaUpgrade({
        indices: { agents: 'test-agents-v1' },
        type: 'mixed',
        versions: { agents: 1 },
      }),
    ).toThrow('mixed schema versions');
  });

  it('throws when the served version is newer than the running build', () => {
    expect(() =>
      planFtsSearchIndexSchemaUpgrade({ indices: {}, type: 'versioned', version: 3 }, 2),
    ).toThrow('newer than this build');
  });

  it('throws when the served version has no journal entry', () => {
    expect(() =>
      planFtsSearchIndexSchemaUpgrade({ indices: {}, type: 'versioned', version: 0 }, 2),
    ).toThrow('no upgrade entry');
  });

  it('throws when the served version targets an older build than the current target', () => {
    // Version 1's journal record declares `upgrade.to: 2`, so targeting version 3 is stale.
    expect(() =>
      planFtsSearchIndexSchemaUpgrade({ indices: {}, type: 'versioned', version: 1 }, 3),
    ).toThrow('re-validate');
  });
});

describe('reconcileCompletedBackfillCheckpoint', () => {
  const createState = (
    runStatus: 'backfilling' | 'ready_for_incremental_sync',
    entityStatuses: ('completed' | 'backfilling')[],
  ) =>
    ({
      progress: entityStatuses.map((status, index) => ({ entity: `entity-${index}`, status })),
      run: { id: 'run-1', status: runStatus },
    }) as any;

  it('marks a run ready when the alias switch completed but the checkpoint stayed backfilling', async () => {
    const repository = {
      getTargetRun: vi
        .fn()
        .mockResolvedValue(createState('backfilling', ['completed', 'completed'])),
      markReadyForIncrementalSync: vi.fn().mockResolvedValue(undefined),
    };
    await expect(reconcileCompletedBackfillCheckpoint(repository, 'test', 2)).resolves.toBe(
      'run-1',
    );
    expect(repository.getTargetRun).toHaveBeenCalledWith('test', 2);
    expect(repository.markReadyForIncrementalSync).toHaveBeenCalledWith('run-1');
  });

  it('leaves an unfinished or already-ready checkpoint untouched', async () => {
    for (const state of [
      undefined,
      createState('backfilling', ['completed', 'backfilling']),
      createState('ready_for_incremental_sync', ['completed', 'completed']),
    ]) {
      const repository = {
        getTargetRun: vi.fn().mockResolvedValue(state),
        markReadyForIncrementalSync: vi.fn().mockResolvedValue(undefined),
      };
      await expect(reconcileCompletedBackfillCheckpoint(repository, 'test', 2)).resolves.toBeNull();
      expect(repository.markReadyForIncrementalSync).not.toHaveBeenCalled();
    }
  });
});
