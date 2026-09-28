import type { FtsSearchDocumentEntity } from '@lobechat/types';

import type { FtsSearchEntityGenerationStatus } from './runtime/generationService';

export interface FtsSearchStartupGeneration {
  entities: FtsSearchDocumentEntity[];
  schemaVersion: number;
}

export interface FtsSearchStartupApplyGeneration {
  freshRun: boolean;
  generationEntities: FtsSearchDocumentEntity[];
  processEntities: FtsSearchDocumentEntity[];
  schemaVersion: number;
}

interface FtsSearchStartupOutboxStats {
  dead: number;
  inFlight: number;
  pending: number;
  retrying: number;
}

interface FtsSearchStartupDrainResult {
  hasMore: boolean;
}

interface FtsSearchStartupCoordinatorOptions {
  applyGeneration: (options: FtsSearchStartupApplyGeneration) => Promise<void>;
  describeEntity: (entity: FtsSearchDocumentEntity) => Promise<FtsSearchEntityGenerationStatus>;
  drainIncrementalSync: () => Promise<FtsSearchStartupDrainResult>;
  generations: FtsSearchStartupGeneration[];
  maxDrainRounds?: number;
  promoteEntity: (entity: FtsSearchDocumentEntity) => Promise<void>;
  readCheckpointEntities: (schemaVersion: number) => Promise<FtsSearchDocumentEntity[] | undefined>;
  readOutboxStats: () => Promise<FtsSearchStartupOutboxStats>;
  waitForOutbox?: () => Promise<void>;
}

const unsafeClassification = new Set<FtsSearchEntityGenerationStatus['classification']>([
  'drift',
  'rollback_required',
  'unmanaged',
]);

/** Read-only preflight for generation states that startup automation must never repair implicitly. */
export const assertFtsSearchStartupGenerationSafe = (status: FtsSearchEntityGenerationStatus) => {
  if (unsafeClassification.has(status.classification)) {
    throw new Error(
      `Cannot automatically migrate ${status.entity}: generation is ${status.classification}. ${status.action}`,
    );
  }
  for (const generation of [...status.candidates, ...(status.live ? [status.live] : [])]) {
    if (generation.state === 'open' && !generation.fieldCompatibility?.compatible) {
      throw new Error(
        `Cannot automatically migrate ${status.entity}: ${generation.index} is incompatible with the current document projection`,
      );
    }
  }
  if (
    status.classification === 'in_sync' &&
    status.live?.backfill === 'unknown' &&
    status.live.index !== status.declared.index
  ) {
    throw new Error(
      `${status.live.index} has current in-place metadata but no checkpoint proves its backfill completed`,
    );
  }
};

const assertOutboxIdle = (stats: FtsSearchStartupOutboxStats) => {
  if (stats.dead + stats.inFlight + stats.pending + stats.retrying === 0) return;
  throw new Error(
    `Elasticsearch startup migration left Outbox work (pending=${stats.pending}, retrying=${stats.retrying}, inFlight=${stats.inFlight}, dead=${stats.dead})`,
  );
};

/** Runs the complete fail-closed startup migration while its caller holds the namespace lock. */
export const runFtsSearchStartupMigration = async ({
  applyGeneration,
  describeEntity,
  drainIncrementalSync,
  generations,
  maxDrainRounds = 1,
  promoteEntity,
  readCheckpointEntities,
  readOutboxStats,
  waitForOutbox = async () => {},
}: FtsSearchStartupCoordinatorOptions): Promise<void> => {
  const initialStatuses = new Map<FtsSearchDocumentEntity, FtsSearchEntityGenerationStatus>();
  for (const { entities } of generations) {
    for (const entity of entities) {
      const status = await describeEntity(entity);
      assertFtsSearchStartupGenerationSafe(status);
      initialStatuses.set(entity, status);
    }
  }

  for (const generation of generations) {
    const statuses = generation.entities.map((entity) => initialStatuses.get(entity)!);
    const changed = statuses.filter(
      (status) => status.classification !== 'in_sync' || status.live?.backfill === 'backfilling',
    );
    if (changed.length === 0) continue;

    const checkpointEntities = await readCheckpointEntities(generation.schemaVersion);
    const checkpointExists = checkpointEntities !== undefined;
    const uncheckpointedIndex = changed.find(
      (status) =>
        !checkpointExists &&
        status.candidates.some((candidate) => candidate.version === status.declared.version),
    );
    if (uncheckpointedIndex) {
      throw new Error(
        `${uncheckpointedIndex.entity} has a declared generation but no checkpoint proves its backfill completed`,
      );
    }

    const allChangedMissingAndEmpty = changed.every(
      (status) =>
        status.classification === 'missing' &&
        status.live === null &&
        status.candidates.length === 0,
    );

    await applyGeneration({
      freshRun: !checkpointExists && allChangedMissingAndEmpty,
      generationEntities: checkpointExists
        ? [
            ...new Set([
              ...checkpointEntities.filter((entity) => generation.entities.includes(entity)),
              ...changed.map(({ entity }) => entity),
            ]),
          ]
        : changed.map(({ entity }) => entity),
      processEntities: changed.map(({ entity }) => entity),
      schemaVersion: generation.schemaVersion,
    });
  }

  let caughtUp = false;
  for (let round = 0; round < maxDrainRounds; round += 1) {
    const drain = await drainIncrementalSync();
    const stats = await readOutboxStats();
    if (stats.dead > 0) assertOutboxIdle(stats);
    if (!drain.hasMore && stats.inFlight + stats.pending + stats.retrying === 0) {
      caughtUp = true;
      break;
    }
    if (round + 1 < maxDrainRounds) await waitForOutbox();
  }
  if (!caughtUp) {
    throw new Error('Elasticsearch startup migration exceeded its incremental sync drain bound');
  }

  for (const [entity, status] of initialStatuses) {
    if (status.classification !== 'in_sync' || status.live?.backfill === 'backfilling') {
      await promoteEntity(entity);
    }
  }

  assertOutboxIdle(await readOutboxStats());
  for (const entity of initialStatuses.keys()) {
    const status = await describeEntity(entity);
    if (status.classification !== 'in_sync' || status.live?.backfill === 'backfilling') {
      throw new Error(
        `Elasticsearch startup migration did not make ${entity} current (${status.classification})`,
      );
    }
  }
};
