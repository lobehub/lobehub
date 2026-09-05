import { isDeepStrictEqual } from 'node:util';

import type { FtsSearchDocumentEntity } from '@lobechat/types';

import {
  FTS_SEARCH_INDEX_ANALYSIS,
  FTS_SEARCH_INDEX_DEFINITIONS,
  getFtsSearchIndexAlias,
  getFtsSearchIndexSchemaFingerprint,
  getFtsSearchIndexSchemaVersion,
  getFtsSearchPhysicalIndexName,
} from '../../../packages/database/src/repositories/ftsSearchDocument';
import type { FtsSearchSyncOutboxStats } from '../../../packages/database/src/repositories/ftsSearchSyncOutbox';
import type { FtsSearchReindexRunState } from './checkpointRepository';
import type {
  ElasticsearchFtsSearchMappingPropertyResponse,
  FtsSearchReindexGenerationDescription,
} from './elasticsearchClient';

export interface FtsSearchGenerationElasticsearchClient {
  closeIndex: (index: string) => Promise<void>;
  deleteIndex: (index: string) => Promise<void>;
  describeGenerations: (alias: string) => Promise<FtsSearchReindexGenerationDescription[]>;
  promoteAlias: (alias: string, from: readonly string[], to: string) => Promise<void>;
}

/** Reads the checkpoint that tracks one generation, if the operator kept it. */
export type FtsSearchGenerationCheckpointReader = (
  namespace: string,
  schemaVersion: number,
) => Promise<FtsSearchReindexRunState | undefined>;

/**
 * How the live mapping differs from the declared one.
 * - `identical`: same fields, same parameters.
 * - `additive`: the declared mapping only adds fields; Elasticsearch could accept it in place.
 * - `breaking`: a field or the shared analysis changed; only a rebuild can apply it.
 */
export type FtsSearchMappingChange = 'additive' | 'breaking' | 'identical';

/**
 * - `missing`: no alias yet; a first backfill is required.
 * - `unmanaged`: the alias points at an index without reindex `_meta`; the tool never built it.
 * - `in_sync`: the live generation implements the declared version.
 * - `drift`: same version, different fingerprint. A mapping changed without a version bump.
 * - `upgrade_available`: the code declares a newer version than the alias serves.
 * - `rollback_required`: the alias serves a newer version than the deployed code declares.
 */
export type FtsSearchGenerationClassification =
  'drift' | 'in_sync' | 'missing' | 'rollback_required' | 'unmanaged' | 'upgrade_available';

export interface FtsSearchGenerationSummary {
  /** Backfill state from the generation's checkpoint; `unknown` when no checkpoint is available. */
  backfill: 'backfilling' | 'completed' | 'unknown';
  fingerprint: string | null;
  index: string;
  /** Whether `_meta.schema_fingerprint` equals the declared fingerprint (legacy: version only). */
  matchesDeclared: boolean;
  reindexRunId: string | null;
  state: 'closed' | 'open';
  version: number | null;
}

export interface FtsSearchEntityGenerationStatus {
  action: string;
  alias: string;
  /** Generations other than the one the alias serves, oldest first. */
  candidates: FtsSearchGenerationSummary[];
  classification: FtsSearchGenerationClassification;
  declared: { fingerprint: string; index: string; version: number };
  entity: FtsSearchDocumentEntity;
  live: FtsSearchGenerationSummary | null;
  /** Difference between the live mapping and the declared one; `null` without a live generation. */
  mappingChange: FtsSearchMappingChange | null;
}

const propertyMatches = (
  actual: ElasticsearchFtsSearchMappingPropertyResponse | undefined,
  expected: ElasticsearchFtsSearchMappingPropertyResponse,
): boolean => {
  if (
    !actual ||
    actual.type !== expected.type ||
    actual.analyzer !== expected.analyzer ||
    actual.ignore_above !== expected.ignore_above
  ) {
    return false;
  }
  const actualSubfields = Object.keys(actual.fields ?? {}).sort();
  const expectedSubfields = Object.keys(expected.fields ?? {}).sort();
  if (!isDeepStrictEqual(actualSubfields, expectedSubfields)) return false;
  return expectedSubfields.every((subfield) =>
    propertyMatches(actual.fields?.[subfield], expected.fields![subfield]),
  );
};

/**
 * Classifies the live mapping of `entity` against the declared one. Only whole new top-level
 * fields count as additive: Elasticsearch cannot change an existing field's type or analyzer, and
 * new multi-fields on an existing field would leave existing documents unsearchable through them
 * until they are rewritten, so they are treated as breaking to keep the rebuild path honest.
 */
export const classifyMappingChange = (
  entity: FtsSearchDocumentEntity,
  live: NonNullable<FtsSearchReindexGenerationDescription['mappings']>,
  liveAnalysis: Record<string, unknown> | null,
): FtsSearchMappingChange => {
  const declared = FTS_SEARCH_INDEX_DEFINITIONS[entity].mappings;
  if (!isDeepStrictEqual(liveAnalysis, FTS_SEARCH_INDEX_ANALYSIS)) return 'breaking';
  if (live.dynamic !== declared.dynamic) return 'breaking';

  const declaredProperties = declared.properties as Record<
    string,
    ElasticsearchFtsSearchMappingPropertyResponse
  >;
  const liveFields = Object.keys(live.properties);
  if (liveFields.some((field) => !(field in declaredProperties))) return 'breaking';

  let additive = false;
  for (const [field, expected] of Object.entries(declaredProperties)) {
    const actual = live.properties[field];
    if (actual === undefined) {
      additive = true;
      continue;
    }
    if (!propertyMatches(actual, expected)) return 'breaking';
  }
  return additive ? 'additive' : 'identical';
};

const summarize = (
  entity: FtsSearchDocumentEntity,
  generation: FtsSearchReindexGenerationDescription,
  checkpoint: FtsSearchReindexRunState | undefined,
): FtsSearchGenerationSummary => {
  const progress = checkpoint?.progress.find((item) => item.entity === entity);
  const fingerprint = generation.meta?.schema_fingerprint ?? null;
  return {
    backfill:
      progress?.physicalIndex === generation.index
        ? progress.status === 'completed'
          ? 'completed'
          : 'backfilling'
        : 'unknown',
    fingerprint,
    index: generation.index,
    matchesDeclared:
      generation.meta?.schema_version === getFtsSearchIndexSchemaVersion(entity) &&
      (fingerprint === null || fingerprint === getFtsSearchIndexSchemaFingerprint(entity)),
    reindexRunId: generation.meta?.reindex_run_id ?? null,
    state: generation.state,
    version: generation.meta?.schema_version ?? generation.version,
  };
};

export const describeEntityGeneration = async ({
  client,
  entity,
  namespace,
  readCheckpoint,
}: {
  client: Pick<FtsSearchGenerationElasticsearchClient, 'describeGenerations'>;
  entity: FtsSearchDocumentEntity;
  namespace: string;
  readCheckpoint: FtsSearchGenerationCheckpointReader;
}): Promise<FtsSearchEntityGenerationStatus> => {
  const alias = getFtsSearchIndexAlias(namespace, entity);
  const declaredVersion = getFtsSearchIndexSchemaVersion(entity);
  const declared = {
    fingerprint: getFtsSearchIndexSchemaFingerprint(entity),
    index: getFtsSearchPhysicalIndexName(namespace, entity),
    version: declaredVersion,
  };
  const generations = await client.describeGenerations(alias);

  const checkpoints = new Map<number, FtsSearchReindexRunState | undefined>();
  const checkpointFor = async (version: number | null) => {
    if (version === null) return;
    if (!checkpoints.has(version)) {
      checkpoints.set(version, await readCheckpoint(namespace, version));
    }
    return checkpoints.get(version);
  };

  const liveGeneration = generations.find((generation) => generation.isWriteIndex);
  const live = liveGeneration
    ? summarize(entity, liveGeneration, await checkpointFor(liveGeneration.version))
    : null;
  const candidates: FtsSearchGenerationSummary[] = [];
  for (const generation of generations) {
    if (generation === liveGeneration) continue;
    candidates.push(summarize(entity, generation, await checkpointFor(generation.version)));
  }
  const mappingChange =
    liveGeneration?.mappings && liveGeneration.state === 'open'
      ? classifyMappingChange(entity, liveGeneration.mappings, liveGeneration.analysis)
      : null;

  const declaredCandidate = candidates.find((candidate) => candidate.version === declaredVersion);
  let classification: FtsSearchGenerationClassification;
  let action: string;
  if (!live) {
    classification = 'missing';
    action = `Run --apply --fresh-run to build ${declared.index} and create ${alias}`;
  } else if (live.version === null || live.reindexRunId === null) {
    classification = 'unmanaged';
    action = `${live.index} carries no reindex _meta; rebuild it with this tool before relying on generation checks`;
  } else if (live.version === declaredVersion) {
    classification = live.matchesDeclared ? 'in_sync' : 'drift';
    if (!live.matchesDeclared) {
      action = `The v${declaredVersion} mapping changed without a version bump; bump schemaVersion, then --apply and --promote`;
    } else if (live.backfill !== 'completed' && live.backfill !== 'unknown') {
      // An in-place upgrade restamps the live index first and backfills the new fields afterwards.
      action = `Finish --apply --entity=${entity} to backfill the in-place upgrade of ${live.index}`;
    } else {
      action = 'No action';
    }
  } else if (live.version < declaredVersion) {
    classification = 'upgrade_available';
    if (declaredCandidate) {
      action =
        declaredCandidate.backfill === 'completed' && declaredCandidate.matchesDeclared
          ? `Run --promote --entity=${entity} once the Outbox is drained`
          : `Finish --apply --entity=${entity} to complete ${declaredCandidate.index}`;
    } else if (mappingChange === 'additive') {
      action = `Run --apply --entity=${entity} to build ${declared.index}, or --apply --in-place --entity=${entity} to add the new fields to ${live.index}`;
    } else {
      action = `Run --apply --entity=${entity} to build ${declared.index}`;
    }
  } else {
    classification = 'rollback_required';
    action = `${alias} serves v${live.version} but the deployed code declares v${declaredVersion}; deploy matching code or --promote --entity=${entity} --version=${declaredVersion}`;
  }

  return { action, alias, candidates, classification, declared, entity, live, mappingChange };
};

export interface FtsSearchPromoteGenerationOptions {
  client: FtsSearchGenerationElasticsearchClient;
  entity: FtsSearchDocumentEntity;
  namespace: string;
  outboxStats: Pick<FtsSearchSyncOutboxStats, 'dead' | 'inFlight' | 'pending' | 'retrying'>;
  readCheckpoint: FtsSearchGenerationCheckpointReader;
  /** Target generation; defaults to the declared version. Any other existing version is a rollback. */
  version?: number;
}

export interface FtsSearchPromoteGenerationResult {
  alias: string;
  from: string[];
  to: string;
}

/**
 * Atomically points the entity alias at a generation. Preconditions fail closed: the target must
 * exist and be open, be fully backfilled according to its checkpoint (or, for rollbacks to a
 * previously promoted generation, already carry reindex `_meta`), and the Outbox must be idle so
 * every change captured so far has reached the target.
 */
export const promoteGeneration = async ({
  client,
  entity,
  namespace,
  outboxStats,
  readCheckpoint,
  version = getFtsSearchIndexSchemaVersion(entity),
}: FtsSearchPromoteGenerationOptions): Promise<FtsSearchPromoteGenerationResult> => {
  const alias = getFtsSearchIndexAlias(namespace, entity);
  const status = await describeEntityGeneration({ client, entity, namespace, readCheckpoint });
  const target = [...status.candidates, ...(status.live ? [status.live] : [])].find(
    (generation) => generation.version === version,
  );
  if (!target) {
    throw new Error(`No v${version} generation exists for ${alias}; run --apply first`);
  }
  if (status.live?.index === target.index) {
    throw new Error(`${alias} already serves ${target.index}`);
  }
  if (target.state !== 'open') {
    throw new Error(`${target.index} is closed (being retired) and cannot be promoted`);
  }
  if (version === getFtsSearchIndexSchemaVersion(entity) && !target.matchesDeclared) {
    throw new Error(
      `${target.index} was not built from the declared v${version} mapping; rebuild it before promoting`,
    );
  }
  if (target.backfill === 'backfilling') {
    throw new Error(`${target.index} backfill is incomplete; finish --apply --entity=${entity}`);
  }
  if (target.backfill === 'unknown' && target.reindexRunId === null) {
    throw new Error(
      `${target.index} has no checkpoint and no reindex _meta, so its contents cannot be trusted`,
    );
  }
  if (target.backfill === 'unknown' && version > (status.live?.version ?? 0)) {
    throw new Error(
      `No checkpoint proves ${target.index} finished its backfill; keep ES_REINDEX_STATE_DIR from the --apply run`,
    );
  }
  const pendingWork = outboxStats.pending + outboxStats.retrying + outboxStats.inFlight;
  if (outboxStats.dead > 0 || pendingWork > 0) {
    throw new Error(
      `Outbox is not idle (pending=${outboxStats.pending}, retrying=${outboxStats.retrying}, inFlight=${outboxStats.inFlight}, dead=${outboxStats.dead}); let fts-search:sync drain before promoting`,
    );
  }

  const from = status.live ? [status.live.index] : [];
  await client.promoteAlias(alias, from, target.index);
  return { alias, from, to: target.index };
};

export interface FtsSearchRetireGenerationsOptions {
  client: FtsSearchGenerationElasticsearchClient;
  entity: FtsSearchDocumentEntity;
  namespace: string;
  readCheckpoint: FtsSearchGenerationCheckpointReader;
}

export interface FtsSearchRetireGenerationsResult {
  alias: string;
  closed: string[];
  deleted: string[];
  kept: string;
}

/**
 * Retires every generation the alias does not serve, in two phases so incremental sync never
 * writes to a deleted index (Elasticsearch would silently auto-create it): an open generation is
 * closed first, which removes it from the sync target list on the next drain; a generation that
 * is already closed is deleted. Run the command twice, at least one sync interval apart.
 */
export const retireGenerations = async ({
  client,
  entity,
  namespace,
  readCheckpoint,
}: FtsSearchRetireGenerationsOptions): Promise<FtsSearchRetireGenerationsResult> => {
  const status = await describeEntityGeneration({ client, entity, namespace, readCheckpoint });
  if (!status.live) {
    throw new Error(`${status.alias} has no live generation; nothing is safe to retire`);
  }
  if (status.classification !== 'in_sync') {
    throw new Error(
      `${status.alias} is ${status.classification}; retire only after the declared generation is promoted`,
    );
  }
  const closed: string[] = [];
  const deleted: string[] = [];
  for (const candidate of status.candidates) {
    if (candidate.index === status.live.index) continue;
    if (candidate.state === 'open') {
      await client.closeIndex(candidate.index);
      closed.push(candidate.index);
    } else {
      await client.deleteIndex(candidate.index);
      deleted.push(candidate.index);
    }
  }
  return { alias: status.alias, closed, deleted, kept: status.live.index };
};
