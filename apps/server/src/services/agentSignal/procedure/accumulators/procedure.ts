import type { AgentSignalPolicyStateStore } from '../../store/types';
import { scoreDomainProcedureBatch } from '../batchScorer';
import { getCoarseProcedureDomain, PROCEDURE_ACCUMULATOR_POLICY_ID } from '../keys';
import type {
  AgentSignalProcedureRecord,
  DomainProcedureAccumulatorState,
  DomainProcedureBatchScore,
} from '../types';

/**
 * Default deterministic P0 scoring thresholds for weak procedure candidates.
 */
export interface ProcedureAccumulatorScoringDefaults {
  /** Cheap score threshold that represents repeated weak positive evidence. */
  cheapScoreThreshold: number;
  /** Minimum record count that can force scoring even when score is low. */
  minRecords: number;
}

const DEFAULT_SCORING_OPTIONS = {
  cheapScoreThreshold: 1,
  minRecords: 2,
} satisfies ProcedureAccumulatorScoringDefaults;

/**
 * Scoring gate options for accumulated procedure buckets.
 */
export interface ScoreAccumulatorOptions {
  /** Cheap score threshold that triggers batch scoring. */
  cheapScoreThreshold: number;
  /** Minimum number of records that triggers batch scoring. */
  minRecords: number;
  /** Current millisecond timestamp. */
  now: number;
  /** Optional quiet window in milliseconds after the last record. */
  quietWindowMs?: number;
}

/**
 * Appends one procedure record into a domain accumulator state.
 *
 * Use when:
 * - Domain facts need to be bucketed by scope and coarse domain
 * - Direct tool outcomes should enter as zero-pressure context
 *
 * Expects:
 * - `record.scopeKey` is the runtime scope used by planner suppression
 *
 * Returns:
 * - Updated accumulator state
 */
export const appendDomainProcedureRecord = (
  current: DomainProcedureAccumulatorState | undefined,
  record: AgentSignalProcedureRecord,
): DomainProcedureAccumulatorState => {
  const domain = getCoarseProcedureDomain(record.domainKey);
  const bucketKey = `${record.scopeKey}:${domain}`;
  const cheapScoreDelta = record.accumulatorRole === 'context' ? 0 : (record.cheapScoreDelta ?? 0);

  if (!current) {
    return {
      bucketKey,
      cheapScore: cheapScoreDelta,
      domain,
      firstSeenAt: record.createdAt,
      lastSeenAt: record.createdAt,
      recordCount: 1,
      recordIds: [record.id],
      scopeKey: record.scopeKey,
      version: '1',
    };
  }

  return {
    ...current,
    cheapScore: current.cheapScore + cheapScoreDelta,
    lastSeenAt: record.createdAt,
    recordCount: current.recordCount + 1,
    recordIds: current.recordIds.includes(record.id)
      ? current.recordIds
      : [...current.recordIds, record.id],
  };
};

/**
 * Determines whether an accumulator bucket should be scored.
 *
 * Use when:
 * - Deciding whether weak signals have enough pressure for batch scoring
 * - Quiet-window scoring should flush low-volume buckets
 *
 * Expects:
 * - `now` and bucket timestamps are milliseconds
 *
 * Returns:
 * - Whether scoring should run
 */
export const shouldScoreAccumulator = (
  state: DomainProcedureAccumulatorState,
  options: ScoreAccumulatorOptions,
) => {
  if (state.recordCount >= options.minRecords) return true;
  if (state.cheapScore >= options.cheapScoreThreshold) return true;
  if (options.quietWindowMs && options.now - state.lastSeenAt >= options.quietWindowMs) return true;
  return false;
};

/**
 * Writes one procedure record into the policy-state accumulator bucket.
 *
 * Use when:
 * - Direct or async procedure records should feed domain accumulation
 * - Inspector and evals need bucket-level visibility
 *
 * Expects:
 * - Store writes merge hash fields
 *
 * Returns:
 * - Resolves after the bucket field is persisted
 */
export const appendProcedureAccumulatorRecord = async (
  store: AgentSignalPolicyStateStore,
  record: AgentSignalProcedureRecord,
  ttlSeconds: number,
) => {
  const domain = getCoarseProcedureDomain(record.domainKey);
  const bucketKey = `${record.scopeKey}:${domain}`;

  await store.writePolicyState(
    PROCEDURE_ACCUMULATOR_POLICY_ID,
    bucketKey,
    {
      [`record:${record.id}`]: JSON.stringify(record),
      bucketKey,
      domain,
      lastSeenAt: String(record.createdAt),
      scopeKey: record.scopeKey,
      version: '1',
    },
    ttlSeconds,
  );
};

/**
 * Result returned when a procedure accumulator bucket crosses a scoring gate.
 */
export interface ProcedureAccumulatorScoreResult {
  /** Bucket state reconstructed from stored records. */
  bucket: DomainProcedureAccumulatorState;
  /** Records included in the scored bucket. */
  records: AgentSignalProcedureRecord[];
  /** Batch score produced for the reconstructed bucket. */
  score: DomainProcedureBatchScore;
}

/**
 * Options for appending and scoring one procedure record.
 */
export interface AppendAndScoreProcedureAccumulatorOptions {
  /** Optional cheap score threshold override. */
  cheapScoreThreshold?: number;
  /** Optional minimum record count override. */
  minRecords?: number;
  /** Current millisecond timestamp for scoring. */
  now: number;
  /** Optional quiet window in milliseconds after the last record. */
  quietWindowMs?: number;
}

const parseAccumulatorBucketKey = (bucketKey: string) => {
  const separatorIndex = bucketKey.lastIndexOf(':');

  if (separatorIndex < 0) {
    return undefined;
  }

  return {
    domain: bucketKey.slice(separatorIndex + 1),
    scopeKey: bucketKey.slice(0, separatorIndex),
  };
};

const isProcedureRecordShape = (value: unknown): value is AgentSignalProcedureRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const record = value as Partial<AgentSignalProcedureRecord>;
  const refs = record.refs as Record<string, unknown> | undefined;
  const hasStringArray = (items: unknown) =>
    items === undefined ||
    (Array.isArray(items) && items.every((item) => typeof item === 'string'));
  const hasRelatedObjectsShape = (items: unknown) =>
    items === undefined ||
    (Array.isArray(items) &&
      items.every((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;

        const relatedObject = item as Record<string, unknown>;

        return (
          typeof relatedObject.objectId === 'string' &&
          typeof relatedObject.objectType === 'string' &&
          (relatedObject.relation === undefined || typeof relatedObject.relation === 'string')
        );
      }));

  return (
    (record.accumulatorRole === undefined ||
      record.accumulatorRole === 'candidate' ||
      record.accumulatorRole === 'context' ||
      record.accumulatorRole === 'ignored') &&
    (record.cheapScoreDelta === undefined || typeof record.cheapScoreDelta === 'number') &&
    typeof record.createdAt === 'number' &&
    Number.isFinite(record.createdAt) &&
    typeof record.domainKey === 'string' &&
    typeof record.id === 'string' &&
    (record.intentClass === undefined || typeof record.intentClass === 'string') &&
    typeof record.refs === 'object' &&
    record.refs !== null &&
    !Array.isArray(record.refs) &&
    hasStringArray(refs?.actionIds) &&
    hasStringArray(refs?.resultIds) &&
    hasStringArray(refs?.signalIds) &&
    hasStringArray(refs?.sourceIds) &&
    hasRelatedObjectsShape(record.relatedObjects) &&
    typeof record.scopeKey === 'string' &&
    (record.status === 'failed' ||
      record.status === 'handled' ||
      record.status === 'observed' ||
      record.status === 'suppressed') &&
    (record.summary === undefined || typeof record.summary === 'string')
  );
};

const parseAccumulatorRecord = (value: string) => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isProcedureRecordShape(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const parseStoredRecordIds = (value: string | undefined) => {
  if (!value) return undefined;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;

    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return undefined;
  }
};

const hasSameRecordIds = (left: string[] | undefined, right: string[]) => {
  if (!left || left.length !== right.length) return false;

  const rightIds = new Set(right);

  return left.every((id) => rightIds.has(id));
};

const readProcedureAccumulatorRecords = async (
  store: Pick<AgentSignalPolicyStateStore, 'readPolicyState'>,
  bucketKey: string,
) => {
  const state = await store.readPolicyState(PROCEDURE_ACCUMULATOR_POLICY_ID, bucketKey);
  const bucket = parseAccumulatorBucketKey(bucketKey);

  return Object.entries(state ?? {})
    .filter(([key]) => key.startsWith('record:'))
    .map(([, value]) => parseAccumulatorRecord(value))
    .filter((record): record is AgentSignalProcedureRecord => {
      if (!record || !bucket) return false;

      return (
        record.scopeKey === bucket.scopeKey &&
        getCoarseProcedureDomain(record.domainKey) === bucket.domain
      );
    })
    .sort((a, b) => a.createdAt - b.createdAt);
};

/**
 * Reconstructs a deterministic accumulator bucket from persisted records.
 *
 * Use when:
 * - Policy state stores raw record fields and runtime needs the current bucket score
 * - Weak feedback should accumulate across multiple source events in the same scope
 *
 * Expects:
 * - Records belong to the same coarse domain and runtime scope
 *
 * Returns:
 * - A reconstructed bucket or undefined when no records exist
 */
export const composeProcedureAccumulatorBucket = (records: AgentSignalProcedureRecord[]) => {
  let bucket: DomainProcedureAccumulatorState | undefined;

  for (const record of records) {
    bucket = appendDomainProcedureRecord(bucket, record);
  }

  return bucket;
};

/**
 * Appends one record and scores the bucket when deterministic gates are met.
 *
 * Use when:
 * - Weak signal records should become an accumulated procedure signal
 * - The caller needs both persisted accumulator fields and a scored batch payload
 *
 * Expects:
 * - `record.scopeKey` is the runtime scope shared with marker writes
 *
 * Returns:
 * - Score result when the bucket crosses a gate, otherwise undefined
 */
export const appendAndScoreProcedureAccumulatorRecord = async (
  store: AgentSignalPolicyStateStore,
  record: AgentSignalProcedureRecord,
  ttlSeconds: number,
  options: AppendAndScoreProcedureAccumulatorOptions,
): Promise<ProcedureAccumulatorScoreResult | undefined> => {
  // Each incoming signal record is first stored, then the bucket is rebuilt from stored records.
  // This means the visible numeric state is always derived from persisted facts:
  // `recordCount` increments by one, `recordIds` gains the new id, `lastSeenAt` moves forward, and
  // `cheapScore` changes by the record's effective delta. Scoring runs only when the rebuilt bucket
  // crosses one of the configured gates.
  //
  // Current tunable gates are `cheapScoreThreshold`, `minRecords`, and `quietWindowMs`.
  await appendProcedureAccumulatorRecord(store, record, ttlSeconds);

  const domain = getCoarseProcedureDomain(record.domainKey);
  const bucketKey = `${record.scopeKey}:${domain}`;
  const accumulatorState = await store.readPolicyState(PROCEDURE_ACCUMULATOR_POLICY_ID, bucketKey);
  const records = await readProcedureAccumulatorRecords(store, bucketKey);
  const bucket = composeProcedureAccumulatorBucket(records);

  if (!bucket) return undefined;
  if (
    accumulatorState?.lastScoredAt &&
    hasSameRecordIds(parseStoredRecordIds(accumulatorState.recordIds), bucket.recordIds)
  ) {
    return undefined;
  }

  if (
    !shouldScoreAccumulator(bucket, {
      cheapScoreThreshold:
        options.cheapScoreThreshold ?? DEFAULT_SCORING_OPTIONS.cheapScoreThreshold,
      minRecords: options.minRecords ?? DEFAULT_SCORING_OPTIONS.minRecords,
      now: options.now,
      quietWindowMs: options.quietWindowMs,
    })
  ) {
    return undefined;
  }

  const score = scoreDomainProcedureBatch({ bucket, now: options.now, records });
  const scoredBucket = {
    ...bucket,
    lastBatch: score,
    lastEmittedAt: options.now,
    lastScoredAt: options.now,
  };

  await store.writePolicyState(
    PROCEDURE_ACCUMULATOR_POLICY_ID,
    bucketKey,
    {
      bucketKey,
      cheapScore: String(scoredBucket.cheapScore),
      domain: scoredBucket.domain,
      firstSeenAt: String(scoredBucket.firstSeenAt),
      lastBatch: JSON.stringify(score),
      lastEmittedAt: String(options.now),
      lastScoredAt: String(options.now),
      lastSeenAt: String(scoredBucket.lastSeenAt),
      recordCount: String(scoredBucket.recordCount),
      recordIds: JSON.stringify(scoredBucket.recordIds),
      scopeKey: scoredBucket.scopeKey,
      version: scoredBucket.version,
    },
    ttlSeconds,
  );

  return { bucket: scoredBucket, records, score };
};
