import type { AcceptanceSubjectType } from '@lobechat/types';

import type { VerifyCheckResultItem } from '@/database/schemas/verify';
import { IndexedDBQueryProjectionStorage } from '@/libs/queryProjectionStorage';
import { defineReplica } from '@/libs/replica';
import type { AcceptanceBundle, AcceptanceBySubject, VerifyStateResponse } from '@/services/verify';

/**
 * The Acceptance aggregate of one acceptance id (`acceptanceBundleMap[id]`):
 * the live review surface read by the Acceptance viewer, the task acceptance
 * tab, the acceptance portal and the workbench embed.
 *
 * Persisted to IndexedDB, so a reload paints the last-seen bundle from the
 * local projection before the network confirms it — a 5s poll keeps the live
 * decision surface current afterwards.
 */
export const acceptanceBundleResource = defineReplica<string, AcceptanceBundle>({
  key: (acceptanceId) => acceptanceId,
  name: 'acceptanceBundle',
  storage: 'indexedDB',
  version: 1,
});

/** The subject (topic / task / document) an acceptance is attached to. */
export interface AcceptanceBySubjectParams {
  subjectId: string;
  subjectType: AcceptanceSubjectType;
}

/** One subject's entry key in `acceptanceBySubjectMap`. */
export const acceptanceBySubjectKey = ({ subjectId, subjectType }: AcceptanceBySubjectParams) =>
  `${subjectType}:${subjectId}`;

/**
 * The standing acceptance aggregate attached to a subject, keyed
 * `<subjectType>:<subjectId>` (`acceptanceBySubjectMap`). A subject without an
 * acceptance resolves to nothing — the sync hook keeps polling at a fast
 * interval to discover the aggregate a later verify run creates.
 */
export const acceptanceBySubjectResource = defineReplica<
  AcceptanceBySubjectParams,
  AcceptanceBySubject,
  AcceptanceBySubject
>({
  key: acceptanceBySubjectKey,
  name: 'acceptanceBySubject',
  storage: 'indexedDB',
  version: 1,
});

/** The plan + rollup status and per-item results of one Agent Run's verify round. */
export interface VerifyRunSnapshot {
  results: VerifyCheckResultItem[];
  /** `null` when the run has no verify state on the server. */
  state: VerifyStateResponse | null;
}

const SETTLED_VERIFY_STATUSES = new Set(['delivered', 'errored', 'failed', 'passed']);

/** Mirrors the server's repair gate: an `errored` check is infra, not a delivery fault. */
const isFailedResult = (result: VerifyCheckResultItem | undefined): boolean =>
  !!result &&
  result.status !== 'errored' &&
  (result.status === 'failed' || result.verdict === 'failed' || result.verdict === 'uncertain');

/**
 * A `failed` run with a failed required `auto_repair` check is about to flip to
 * `repairing` (the server spawns the repair right after settling the verdict),
 * so that verdict is not final yet — unless the server recorded that it
 * declined the repair (cap reached, superseded round, no spawner, spawn failed).
 */
const awaitsAutoRepair = ({ results, state }: VerifyRunSnapshot): boolean => {
  if (state?.verifyAutoRepair === 'declined') return false;
  const byItem = new Map(results.map((result) => [result.checkItemId, result]));
  return (state?.verifyPlan ?? []).some(
    (item) =>
      item.required !== false &&
      item.onFail === 'auto_repair' &&
      isFailedResult(byItem.get(item.id)),
  );
};

const UNFINISHED_RESULT_STATUSES = new Set(['pending', 'running']);

/**
 * State and results are two requests with no shared snapshot: a check that
 * finishes between them can pair the terminal status with its pre-commit
 * pending row (or no row). Only a snapshot where every required check has a
 * finished result is consistent enough to replay.
 */
const hasFinishedRequiredResults = ({ results, state }: VerifyRunSnapshot): boolean => {
  const byItem = new Map(results.map((result) => [result.checkItemId, result]));
  return (state?.verifyPlan ?? [])
    .filter((item) => item.required !== false)
    .every((item) => {
      const result = byItem.get(item.id);
      return !!result && !UNFINISHED_RESULT_STATUSES.has(result.status);
    });
};

/** A run whose verdict no longer moves — the only kind worth replaying after a reload. */
export const isSettledVerifyRun = (run: VerifyRunSnapshot | undefined): boolean => {
  const status = run?.state?.verifyStatus;
  if (!run || !status || !SETTLED_VERIFY_STATUSES.has(status)) return false;
  if (!hasFinishedRequiredResults(run)) return false;
  return status !== 'failed' || !awaitsAutoRepair(run);
};

const VERIFY_RUN_NAME = 'verifyRun';
const VERIFY_RUN_VERSION = 1;

/**
 * Persist settled runs only. A planned / verifying / repairing run, or a failed
 * run whose auto-repair is still to come, maps to `null`: the engine then drops
 * any earlier row and keeps the key out of its index (so filtered runs never
 * count toward `persist.maxEntries`). A reload cannot replay a stale spinner or
 * a premature verdict.
 */
export const toPersistedVerifyRun = (run: VerifyRunSnapshot): VerifyRunSnapshot | null =>
  isSettledVerifyRun(run) ? run : null;

/**
 * The verify card of one Agent Run (`verifyRunMap[operationId]`), read by the
 * chat thread's Verify message, the verify result portal and the task run
 * detail. State and results live in one entry so a persisted card never pairs
 * a verdict with results from another moment.
 *
 * Settled runs persist to IndexedDB, so a reload paints the last verdict in
 * the first frame and revalidates in the background; LRU-capped because every
 * verified run in history would otherwise keep its row.
 */
export const verifyRunResource = defineReplica<string, VerifyRunSnapshot>({
  key: (operationId) => operationId,
  name: VERIFY_RUN_NAME,
  persist: { maxEntries: 100 },
  storage: new IndexedDBQueryProjectionStorage<VerifyRunSnapshot>({
    namespace: `replica:${VERIFY_RUN_NAME}:v${VERIFY_RUN_VERSION}`,
  }),
  version: VERIFY_RUN_VERSION,
});
