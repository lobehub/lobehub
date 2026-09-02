import type { FtsSearchDocumentEntity } from '@lobechat/types';
import { FTS_SEARCH_DOCUMENT_ENTITIES } from '@lobechat/types';

import {
  FTS_SEARCH_INDEX_SCHEMA_VERSION,
  type FtsSearchIndexSchemaUpgradeStrategy,
  getFtsSearchIndexAlias,
  getFtsSearchIndexSchemaVersionRecord,
  parseFtsSearchPhysicalIndexVersion,
} from '../../../packages/database/src/repositories/ftsSearchDocument';
import type { FtsSearchReindexRunState } from './checkpointRepository';

export interface FtsSearchSchemaDetectionClient {
  resolveAliasTarget: (alias: string) => Promise<string | null>;
}

export type FtsSearchIndexSchemaState =
  | { type: 'missing' }
  | { indices: Record<string, string>; type: 'mixed'; versions: Record<string, number | null> }
  | { indices: Record<string, string>; type: 'versioned'; version: number };

/**
 * Reads the schema version currently served by the stable aliases. Every entity must agree; a
 * namespace split across versions is reported instead of guessed so the operator can repair it.
 */
export const detectFtsSearchIndexSchemaState = async (
  client: FtsSearchSchemaDetectionClient,
  namespace: string,
  entities: readonly FtsSearchDocumentEntity[] = FTS_SEARCH_DOCUMENT_ENTITIES,
): Promise<FtsSearchIndexSchemaState> => {
  const indices: Record<string, string> = {};
  const versions: Record<string, number | null> = {};
  for (const entity of entities) {
    const target = await client.resolveAliasTarget(getFtsSearchIndexAlias(namespace, entity));
    if (!target) continue;
    indices[entity] = target;
    versions[entity] = parseFtsSearchPhysicalIndexVersion(namespace, entity, target);
  }
  const found = Object.keys(indices);
  if (found.length === 0) return { type: 'missing' };
  const distinct = new Set(Object.values(versions));
  const [version] = distinct;
  if (found.length !== entities.length || distinct.size !== 1 || version === null) {
    return { indices, type: 'mixed', versions };
  }
  return { indices, type: 'versioned', version };
};

export type FtsSearchIndexSchemaUpgradePlan =
  | { type: 'up_to_date'; version: number }
  | {
      fromVersion: number;
      strategy: FtsSearchIndexSchemaUpgradeStrategy;
      toVersion: number;
      type: 'upgrade';
    };

/** Resolves the journal entry for the served version into the concrete upgrade step to run. */
export const planFtsSearchIndexSchemaUpgrade = (
  state: FtsSearchIndexSchemaState,
  targetVersion: number = FTS_SEARCH_INDEX_SCHEMA_VERSION,
): FtsSearchIndexSchemaUpgradePlan => {
  if (state.type === 'missing') {
    throw new Error(
      'No stable aliases exist yet; run the initial migration with --apply --fresh-run --yes instead of --upgrade',
    );
  }
  if (state.type === 'mixed') {
    throw new Error(
      `Stable aliases point to mixed schema versions: ${JSON.stringify(state.indices)}; repair the aliases before upgrading`,
    );
  }
  if (state.version === targetVersion) return { type: 'up_to_date', version: state.version };
  if (state.version > targetVersion) {
    throw new Error(
      `Stable aliases serve schema version ${state.version}, newer than this build's ${targetVersion}; deploy a newer build or repair the aliases`,
    );
  }
  const record = getFtsSearchIndexSchemaVersionRecord(state.version);
  if (!record || record.upgrade === 'current') {
    throw new Error(
      `Schema version ${state.version} has no upgrade entry in FTS_SEARCH_INDEX_SCHEMA_HISTORY`,
    );
  }
  if (record.upgrade.to !== targetVersion) {
    throw new Error(
      `Schema version ${state.version} declares an upgrade to ${record.upgrade.to}, not ${targetVersion}; re-validate its strategy in FTS_SEARCH_INDEX_SCHEMA_HISTORY`,
    );
  }
  return {
    fromVersion: state.version,
    strategy: record.upgrade.strategy,
    toVersion: targetVersion,
    type: 'upgrade',
  };
};

export interface FtsSearchBackfillCheckpointRepository {
  getTargetRun: (
    namespace: string,
    version: number,
  ) => Promise<FtsSearchReindexRunState | null | undefined>;
  markReadyForIncrementalSync: (runId: string) => Promise<void>;
}

/**
 * A backfill upgrade switches aliases and then marks its checkpoint ready in two separate steps.
 * If the process dies in between, the aliases already serve the target version, so a rerun plans
 * `up_to_date` and would leave the checkpoint `backfilling` forever. Finish that bookkeeping when
 * every entity is complete and return the run id; anything less is a different, unfinished run
 * that must not be marked ready. Call only after the schema plan confirmed the aliases are current.
 */
export const reconcileCompletedBackfillCheckpoint = async (
  repository: FtsSearchBackfillCheckpointRepository,
  namespace: string,
  targetVersion: number = FTS_SEARCH_INDEX_SCHEMA_VERSION,
): Promise<string | null> => {
  const state = await repository.getTargetRun(namespace, targetVersion);
  if (!state || state.run.status !== 'backfilling') return null;
  if (!state.progress.every((progress) => progress.status === 'completed')) return null;
  await repository.markReadyForIncrementalSync(state.run.id);
  return state.run.id;
};
