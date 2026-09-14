import type { FtsSearchDocumentEntity } from '@lobechat/types';

import {
  FTS_SEARCH_INDEX_ANALYSIS,
  FTS_SEARCH_INDEX_DEFINITIONS,
  getFtsSearchIndexAlias,
  getFtsSearchIndexSchemaFingerprint,
  getFtsSearchIndexSchemaVersion,
  getFtsSearchPhysicalIndexName,
} from '../../../packages/database/src/repositories/ftsSearchDocument';
import type { FtsSearchProjectionCompatibility } from '../../../packages/database/src/repositories/ftsSearchDocument/projectionCompatibility';
import { getFtsSearchProjectionCompatibility } from '../../../packages/database/src/repositories/ftsSearchDocument/projectionCompatibility';
import type { FtsSearchSyncOutboxStats } from '../../../packages/database/src/repositories/ftsSearchSyncOutbox';
import type { FtsSearchReindexRunState } from './checkpointRepository';
import type { FtsSearchReindexGenerationDescription } from './elasticsearchClient';
import type { FtsSearchMappingDiff } from './mappingDiff';
import { diffFtsSearchMappings } from './mappingDiff';

export interface FtsSearchGenerationElasticsearchClient {
  closeIndex: (index: string) => Promise<void>;
  deleteIndex: (index: string) => Promise<void>;
  describeGenerations: (alias: string) => Promise<FtsSearchReindexGenerationDescription[]>;
  ensureRetiredIndexProtection: (index: string) => Promise<void>;
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
  /** Still attached to the entity's read alias, even when it is not the write index. */
  aliased: boolean;
  /** Backfill state from the generation's checkpoint; `unknown` when no checkpoint is available. */
  backfill: 'backfilling' | 'completed' | 'unknown';
  /** Whether the current document source can still populate every field this generation maps. */
  fieldCompatibility: FtsSearchProjectionCompatibility | null;
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
  /** Deterministic field-level details behind `mappingChange`. */
  mappingDiff: FtsSearchMappingDiff | null;
}

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
  const diff = diffFtsSearchMappings({
    declared,
    declaredAnalysis: FTS_SEARCH_INDEX_ANALYSIS,
    live,
    liveAnalysis,
  });
  if (
    diff.analysisChanged ||
    diff.dynamicChanged ||
    diff.removed.length > 0 ||
    diff.changed.length > 0
  ) {
    return 'breaking';
  }
  return diff.added.length > 0 ? 'additive' : 'identical';
};

const summarize = (
  entity: FtsSearchDocumentEntity,
  generation: FtsSearchReindexGenerationDescription,
  checkpoint: FtsSearchReindexRunState | undefined,
): FtsSearchGenerationSummary => {
  const progress = checkpoint?.progress.find((item) => item.entity === entity);
  const fingerprint = generation.meta?.schema_fingerprint ?? null;
  return {
    aliased: generation.aliased,
    backfill:
      progress?.physicalIndex === generation.index
        ? progress.status === 'completed'
          ? 'completed'
          : 'backfilling'
        : 'unknown',
    fieldCompatibility:
      generation.state === 'open' && generation.mappings
        ? getFtsSearchProjectionCompatibility(entity, generation.mappings.properties)
        : null,
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
  const mappingDiff =
    liveGeneration?.mappings && liveGeneration.state === 'open'
      ? diffFtsSearchMappings({
          declared: FTS_SEARCH_INDEX_DEFINITIONS[entity].mappings,
          declaredAnalysis: FTS_SEARCH_INDEX_ANALYSIS,
          live: liveGeneration.mappings,
          liveAnalysis: liveGeneration.analysis,
        })
      : null;
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

  return {
    action,
    alias,
    candidates,
    classification,
    declared,
    entity,
    live,
    mappingChange,
    mappingDiff,
  };
};

export interface FtsSearchPromoteGenerationOptions {
  client: FtsSearchGenerationElasticsearchClient;
  entity: FtsSearchDocumentEntity;
  namespace: string;
  outboxStats: FtsSearchSyncOutboxStats;
  readCheckpoint: FtsSearchGenerationCheckpointReader;
  /** Target generation; defaults to the declared version. Any other existing version is a rollback. */
  version?: number;
}

export interface FtsSearchPromoteGenerationResult {
  alias: string;
  from: string[];
  outcome: 'already_live' | 'promoted';
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
  if (target.state !== 'open') {
    throw new Error(`${target.index} is closed (being retired) and cannot be promoted`);
  }
  if (!target.fieldCompatibility) {
    throw new Error(
      `${target.index} mapping could not be inspected; retry status before promoting`,
    );
  }
  if (!target.fieldCompatibility.compatible) {
    const details = [
      ...target.fieldCompatibility.missingFields.map((field) => `${field} (missing)`),
      ...target.fieldCompatibility.incompatibleFields.map(
        ({ currentType, field, targetType }) => `${field} (${currentType} -> ${targetType})`,
      ),
    ].join(', ');
    throw new Error(
      `${target.index} requires source fields the current projection cannot preserve: ${details}; retain compatible source bridge fields before promoting`,
    );
  }
  if (version === getFtsSearchIndexSchemaVersion(entity) && !target.matchesDeclared) {
    throw new Error(
      `${target.index} was not built from the declared v${version} mapping; rebuild it before promoting`,
    );
  }
  if (
    status.live?.index === target.index &&
    version === getFtsSearchIndexSchemaVersion(entity) &&
    status.mappingChange !== 'identical'
  ) {
    throw new Error(
      `${target.index} physical mapping differs from the declared v${version} mapping`,
    );
  }
  if (target.backfill === 'backfilling') {
    throw new Error(`${target.index} backfill is incomplete; finish --apply --entity=${entity}`);
  }
  if (status.live?.index === target.index) {
    if (target.reindexRunId === null || target.version === null) {
      throw new Error(`${target.index} carries no managed reindex identity and cannot be promoted`);
    }
    return { alias, from: [], outcome: 'already_live', to: target.index };
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
  const entityOutboxStats = outboxStats.entities[entity];
  const pendingWork =
    entityOutboxStats.pending + entityOutboxStats.retrying + entityOutboxStats.inFlight;
  if (entityOutboxStats.dead > 0 || pendingWork > 0) {
    throw new Error(
      `${target.index}: Outbox is not idle (pending=${entityOutboxStats.pending}, retrying=${entityOutboxStats.retrying}, inFlight=${entityOutboxStats.inFlight}, dead=${entityOutboxStats.dead}); let fts-search:sync drain before promoting`,
    );
  }

  const from = status.live ? [status.live.index] : [];
  await client.promoteAlias(alias, from, target.index);
  return { alias, from, outcome: 'promoted', to: target.index };
};

export interface FtsSearchRetireGenerationsOptions {
  client: FtsSearchGenerationElasticsearchClient;
  entity: FtsSearchDocumentEntity;
  namespace: string;
  readCheckpoint: FtsSearchGenerationCheckpointReader;
}

export interface FtsSearchRetireGenerationsResult {
  alias: string;
  alreadyClosed: string[];
  closed: string[];
  /** @deprecated Retirement never deletes indexes; use `purgeRetiredGenerations`. */
  deleted: string[];
  kept: string;
}

export interface FtsSearchRetirementPlan {
  alreadyClosed: string[];
  blockedBy: string[];
  close: string[];
  purgeCandidates: string[];
}

const isKnownManagedGeneration = (
  alias: string,
  generation: FtsSearchGenerationSummary,
): boolean => {
  const suffix = generation.index.slice(`${alias}-v`.length);
  return (
    generation.index.startsWith(`${alias}-v`) &&
    /^\d+$/.test(suffix) &&
    generation.reindexRunId !== null &&
    generation.version !== null
  );
};

/** Shared candidate boundary; state and backfill readiness are checked by each operation. */
const isRetirementCandidate = (
  status: FtsSearchEntityGenerationStatus,
  candidate: FtsSearchGenerationSummary,
): boolean => {
  const liveVersion = status.live?.version;
  return (
    !candidate.aliased &&
    candidate.index !== status.live?.index &&
    isKnownManagedGeneration(status.alias, candidate) &&
    liveVersion !== null &&
    liveVersion !== undefined &&
    candidate.version !== null &&
    candidate.version < liveVersion
  );
};

/** Builds a side-effect-free preview for closing and later purging retired generations. */
export const planRetiredGenerations = (
  status: FtsSearchEntityGenerationStatus,
): FtsSearchRetirementPlan => {
  const blockedBy: string[] = [];
  if (!status.live) blockedBy.push(`${status.alias} has no live generation`);
  if (status.live && status.classification !== 'in_sync') {
    blockedBy.push(`${status.alias} is ${status.classification}`);
  }

  const detached = status.candidates.filter(
    (candidate) => !candidate.aliased && candidate.index !== status.live?.index,
  );
  const close: string[] = [];
  const alreadyClosed: string[] = [];
  const purgeCandidates: string[] = [];
  for (const candidate of detached) {
    if (!isKnownManagedGeneration(status.alias, candidate)) {
      blockedBy.push(`${candidate.index} has no known managed reindex identity`);
      continue;
    }
    if (!isRetirementCandidate(status, candidate)) {
      blockedBy.push(`${candidate.index} is not older than the live generation`);
      continue;
    }
    if (candidate.backfill === 'backfilling') {
      blockedBy.push(`${candidate.index} backfill is still running`);
      continue;
    }
    if (candidate.state === 'open') {
      close.push(candidate.index);
    } else {
      alreadyClosed.push(candidate.index);
      purgeCandidates.push(candidate.index);
    }
  }
  return { alreadyClosed, blockedBy, close, purgeCandidates };
};

/**
 * Closes open generations detached from the alias. Deletion is a separate explicit operation so
 * stale sync workers have time to stop targeting the retired index.
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
  const plan = planRetiredGenerations(status);
  const closed: string[] = [];
  const deleted: string[] = [];
  for (const index of plan.close) {
    await client.closeIndex(index);
    closed.push(index);
  }
  return {
    alreadyClosed: plan.alreadyClosed,
    alias: status.alias,
    closed,
    deleted,
    kept: status.live.index,
  };
};

export interface FtsSearchPurgeRetiredGenerationsResult {
  alias: string;
  deleted: string[];
  kept: string;
}

/** Permanently deletes closed, detached generations after installing an exact-index write guard. */
export const purgeRetiredGenerations = async ({
  client,
  entity,
  namespace,
  readCheckpoint,
}: FtsSearchRetireGenerationsOptions): Promise<FtsSearchPurgeRetiredGenerationsResult> => {
  const status = await describeEntityGeneration({ client, entity, namespace, readCheckpoint });
  if (!status.live) {
    throw new Error(`${status.alias} has no live generation; nothing is safe to purge`);
  }
  if (status.classification !== 'in_sync') {
    throw new Error(
      `${status.alias} is ${status.classification}; purge only after the declared generation is promoted`,
    );
  }

  const plan = planRetiredGenerations(status);
  const backfilling = status.candidates.find(
    (candidate) =>
      isRetirementCandidate(status, candidate) &&
      candidate.state === 'closed' &&
      candidate.backfill === 'backfilling',
  );
  if (backfilling) {
    throw new Error(`${backfilling.index} backfill is still running; it cannot be purged`);
  }

  const deleted: string[] = [];
  for (const index of plan.purgeCandidates) {
    await client.ensureRetiredIndexProtection(index);
    await client.deleteIndex(index);
    deleted.push(index);
  }
  return { alias: status.alias, deleted, kept: status.live.index };
};

/**
 * Resolves the index for a new or resumed in-place run, including the crash window after the live
 * index was restamped but before its checkpoint was persisted.
 */
export const resolveInPlaceTarget = (status: FtsSearchEntityGenerationStatus): string => {
  if (
    status.classification === 'upgrade_available' &&
    status.mappingChange === 'additive' &&
    status.live
  ) {
    return status.live.index;
  }
  if (
    status.classification === 'in_sync' &&
    status.live?.matchesDeclared &&
    status.live.reindexRunId !== null &&
    status.live.index !== status.declared.index
  ) {
    if (status.mappingChange !== 'identical') {
      throw new Error(`${status.live.index} physical mapping differs from the declared mapping`);
    }
    return status.live.index;
  }
  throw new Error(
    `${status.entity} cannot be upgraded in place (${status.classification}, mapping change: ${status.mappingChange ?? 'unknown'}); ${status.action}`,
  );
};
