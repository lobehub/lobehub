import { createNanoId } from '@lobechat/utils';
import { z } from 'zod';

/**
 * Launching a Lobe Bench experiment is several server calls: create the
 * experiment, then for every contender create a run and start it, then save
 * the run ids into the experiment. Any of them can fail or lose its response.
 *
 * The launch record below is written once, before the first call, and freezes
 * everything the launch needs: every id, the case set, the name, the
 * experiment metadata and each contender's full run config. The server creates
 * idempotently on those ids, so running the same record again after a failure
 * reaches the same experiment and the same runs with the same parameters,
 * whatever the draft looks like by then. Nothing is created twice; a run is
 * started only while the server still reports it `idle`.
 */

const runConfigSchema = z.record(z.string(), z.unknown());

const launchContenderSchema = z.object({
  /** The run config this contender was launched with; a resume sends exactly this. */
  config: runConfigSchema,
  /** The dataset this run is on, when the experiment covers several (else the launch's). */
  datasetId: z.string().min(1).optional(),
  /** The draft contender this run belongs to (`LobeBenchContender.id`). */
  key: z.string().min(1),
  name: z.string(),
  /** Which of the experiment's `metadata.parts` this run is, when it has several. */
  part: z.number().int().min(0).optional(),
  runId: z.string().min(1),
});

const launchSchema = z.object({
  /** Where the record is kept (one launch at a time per benchmark). */
  benchmarkId: z.string().min(1),
  /** Every benchmark the experiment covers (experiments and benchmarks are n to n); else `benchmarkId`. */
  benchmarkIds: z.array(z.string().min(1)).min(1).optional(),
  contenders: z.array(launchContenderSchema).min(1),
  createdAt: z.string(),
  datasetId: z.string().min(1),
  experimentId: z.string().min(1),
  /** The experiment metadata as launched, without run ids (added once every run exists). */
  metadata: z.record(z.string(), z.unknown()),
  name: z.string(),
  version: z.literal(2),
});

/** The first record shape: ids only. It can be opened or discarded, never resumed. */
const legacyLaunchSchema = z.object({
  contenders: z.array(z.object({ key: z.string(), name: z.string(), runId: z.string() })).min(1),
  createdAt: z.string(),
  experimentId: z.string().min(1),
  version: z.undefined().optional(),
});

export type ExperimentLaunch = z.infer<typeof launchSchema>;
export type ExperimentLaunchContender = z.infer<typeof launchContenderSchema>;
export interface LegacyExperimentLaunch {
  contenders: Array<{ key: string; name: string; runId: string }>;
  createdAt: string;
  experimentId: string;
  version: 1;
}
export type StoredExperimentLaunch = ExperimentLaunch | LegacyExperimentLaunch;

export const isResumableLaunch = (launch: StoredExperimentLaunch): launch is ExperimentLaunch =>
  launch.version === 2;

export interface ExperimentLaunchScope {
  benchmarkId: string;
  userId: string;
  workspaceId: string | null;
}

/**
 * One record per user, workspace and benchmark. The key is unchanged from the
 * first version on purpose: an older record under it is read as legacy instead
 * of being silently left behind under another key.
 */
export const experimentLaunchKey = ({ benchmarkId, userId, workspaceId }: ExperimentLaunchScope) =>
  `lobe-bench:experiment-launch:v1:${JSON.stringify([userId, workspaceId, benchmarkId])}`;

export const parseExperimentLaunch = (raw: string | null): StoredExperimentLaunch | undefined => {
  if (!raw) return;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const current = launchSchema.safeParse(value);
  if (current.success) return current.data;
  const legacy = legacyLaunchSchema.safeParse(value);
  if (legacy.success) {
    const { version: _version, ...rest } = legacy.data;
    return { ...rest, version: 1 };
  }
  return undefined;
};

// Same shape as the server's ids (`exp_` / `run_` + 12 alphanumerics), so a
// client-made id reads like any other in logs and URLs.
const ID_SIZE = 12;
const makeId = (prefix: string) => `${prefix}_${createNanoId(ID_SIZE)()}`;

/**
 * A fresh launch record: one experiment id, one run id per contender (per contender
 * and dataset, when the experiment covers several), every parameter frozen.
 */
export const createExperimentLaunch = (
  snapshot: {
    benchmarkId: string;
    benchmarkIds?: string[];
    contenders: Array<{
      config: Record<string, unknown>;
      datasetId?: string;
      id: string;
      name: string;
      part?: number;
    }>;
    datasetId: string;
    metadata: Record<string, unknown>;
    name: string;
  },
  now = new Date(),
): ExperimentLaunch => ({
  benchmarkId: snapshot.benchmarkId,
  ...(snapshot.benchmarkIds?.length && { benchmarkIds: snapshot.benchmarkIds }),
  contenders: snapshot.contenders.map((contender) => ({
    config: contender.config,
    ...(contender.datasetId && { datasetId: contender.datasetId }),
    key: contender.id,
    name: contender.name,
    ...(contender.part !== undefined && { part: contender.part }),
    runId: makeId('run'),
  })),
  createdAt: now.toISOString(),
  datasetId: snapshot.datasetId,
  experimentId: makeId('exp'),
  metadata: snapshot.metadata,
  name: snapshot.name,
  version: 2,
});

// ---- Run states as the launch reads them ------------------------------------

/** Waiting for its first start. */
export const isStartableRunStatus = (status: string | null | undefined) => status === 'idle';

/**
 * Accepted by the server: dispatched and past `pending`, or finished. A
 * `pending` run is not in this set: the server marks a run pending *before*
 * dispatching its workflow and does not roll back a failed dispatch, so from
 * the outside pending cannot be told apart from "never dispatched". Starting
 * it again could dispatch twice, so a resume leaves it alone and reports it
 * as unconfirmed; only this attempt's own `startRun` acknowledgement counts.
 */
export const ACCEPTED_RUN_STATUSES = new Set([
  'running',
  'completed',
  'failed',
  'aborted',
  'external',
]);
export const isAcceptedRunStatus = (status: string | null | undefined) =>
  !!status && ACCEPTED_RUN_STATUSES.has(status);

// ---- Storage: compare-before-write so two tabs cannot clobber each other ------

export interface LaunchStorage {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
}

export type BeginResult =
  | { ok: true }
  | { ok: false; reason: 'storage' }
  | { existing: StoredExperimentLaunch; ok: false; reason: 'occupied' };

/**
 * Write a new record unless the scope already holds a different launch. Not
 * atomic across tabs (localStorage has no transactions); the caller narrows the
 * window with a Web Lock when the browser has one.
 */
export const beginLaunchInStorage = (
  storage: LaunchStorage,
  key: string,
  launch: ExperimentLaunch,
): BeginResult => {
  let existing: StoredExperimentLaunch | undefined;
  try {
    existing = parseExperimentLaunch(storage.getItem(key));
  } catch {
    return { ok: false, reason: 'storage' };
  }
  if (existing && existing.experimentId !== launch.experimentId) {
    return { existing, ok: false, reason: 'occupied' };
  }
  try {
    storage.setItem(key, JSON.stringify(launch));
  } catch {
    return { ok: false, reason: 'storage' };
  }
  return { ok: true };
};

/** Remove the record only when it still is the launch the caller finished with. */
export const clearLaunchInStorage = (
  storage: LaunchStorage,
  key: string,
  experimentId: string,
): boolean => {
  try {
    const existing = parseExperimentLaunch(storage.getItem(key));
    if (!existing) return true;
    if (existing.experimentId !== experimentId) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

// ---- The launch itself ----------------------------------------------------------

export interface LaunchServices {
  createExperiment: (params: {
    benchmarkIds: string[];
    id: string;
    metadata: Record<string, unknown>;
    name: string;
  }) => Promise<unknown>;
  createRun: (params: {
    config: Record<string, unknown>;
    datasetId: string;
    experimentId: string;
    id: string;
    name: string;
  }) => Promise<unknown>;
  listRuns: (experimentId: string) => Promise<Array<{ id: string; status?: string | null }>>;
  startRun: (runId: string) => Promise<unknown>;
  updateExperiment: (params: { id: string; metadata: Record<string, unknown> }) => Promise<unknown>;
}

export type LaunchStage = 'experiment' | 'metadata' | 'run' | 'start';

export interface LaunchOutcome {
  /** Every run is accepted and the experiment holds the run ids. */
  complete: boolean;
  error?: { contender?: ExperimentLaunchContender; message: string; stage: LaunchStage };
  experimentId: string;
  /** Accepted before this attempt (running, finished …): left untouched. */
  kept: ExperimentLaunchContender[];
  metadataSaved: boolean;
  /** Started by this attempt: the server acknowledged `startRun`. */
  started: ExperimentLaunchContender[];
  /**
   * Reported `pending` or in a state the launch does not know: possibly
   * dispatched, possibly not. Not started again; the user re-checks later.
   */
  unconfirmed: ExperimentLaunchContender[];
}

const messageOf = (error: unknown) =>
  error instanceof Error && error.message ? error.message : String(error);

const statusOf = (created: unknown): string | null | undefined => {
  if (!created || typeof created !== 'object') return undefined;
  const direct = (created as { status?: string | null }).status;
  if (direct !== undefined) return direct;
  return (created as { data?: { status?: string | null } }).data?.status;
};

/**
 * Run (or resume) a launch record. Reads nothing but the record: the resume of
 * a launch sends what the launch froze. Order: experiment, then every run row,
 * then the run ids into the experiment, then the starts. So no run is started
 * before the experiment knows it, and a failed step stops the attempt where
 * it is; the next attempt begins by reading what the server already has.
 */
export const launchExperiment = async (
  launch: ExperimentLaunch,
  services: LaunchServices,
): Promise<LaunchOutcome> => {
  const outcome: LaunchOutcome = {
    complete: false,
    experimentId: launch.experimentId,
    kept: [],
    metadataSaved: false,
    started: [],
    unconfirmed: [],
  };

  try {
    await services.createExperiment({
      benchmarkIds: launch.benchmarkIds ?? [launch.benchmarkId],
      id: launch.experimentId,
      metadata: launch.metadata,
      name: launch.name,
    });
  } catch (error) {
    outcome.error = { message: messageOf(error), stage: 'experiment' };
    return outcome;
  }

  const status = new Map<string, string | null | undefined>();
  try {
    for (const run of await services.listRuns(launch.experimentId)) status.set(run.id, run.status);
  } catch (error) {
    outcome.error = { message: messageOf(error), stage: 'run' };
    return outcome;
  }

  for (const contender of launch.contenders) {
    if (status.has(contender.runId)) continue;
    try {
      const created = await services.createRun({
        config: contender.config,
        datasetId: contender.datasetId ?? launch.datasetId,
        experimentId: launch.experimentId,
        id: contender.runId,
        name: contender.name,
      });
      status.set(contender.runId, statusOf(created));
    } catch (error) {
      outcome.error = { contender, message: messageOf(error), stage: 'run' };
      return outcome;
    }
  }

  // Each contender's run on the first dataset stays on the contender (what an
  // experiment of one dataset always had); every dataset's runs go on its part.
  const runIdsOfPart = (part: number) =>
    new Map(launch.contenders.filter((c) => (c.part ?? 0) === part).map((c) => [c.key, c.runId]));
  const runIdByKey = runIdsOfPart(0);
  const contenders = Array.isArray(launch.metadata.contenders)
    ? (launch.metadata.contenders as Array<{ id?: string }>)
    : [];
  const parts = Array.isArray(launch.metadata.parts)
    ? (launch.metadata.parts as Array<Record<string, unknown>>)
    : undefined;
  try {
    await services.updateExperiment({
      id: launch.experimentId,
      metadata: {
        ...launch.metadata,
        contenders: contenders.map((contender) => ({
          ...contender,
          runId: contender.id ? runIdByKey.get(contender.id) : undefined,
        })),
        ...(parts && {
          parts: parts.map((part, index) => ({
            ...part,
            runIds: Object.fromEntries(runIdsOfPart(index)),
          })),
        }),
      },
    });
    outcome.metadataSaved = true;
  } catch (error) {
    outcome.error = { message: messageOf(error), stage: 'metadata' };
    return outcome;
  }

  for (const contender of launch.contenders) {
    const current = status.get(contender.runId);
    if (isAcceptedRunStatus(current)) {
      outcome.kept.push(contender);
      continue;
    }
    if (!isStartableRunStatus(current)) {
      outcome.unconfirmed.push(contender);
      continue;
    }
    try {
      await services.startRun(contender.runId);
      outcome.started.push(contender);
    } catch (error) {
      outcome.error = { contender, message: messageOf(error), stage: 'start' };
      return outcome;
    }
  }

  outcome.complete = outcome.unconfirmed.length === 0;
  return outcome;
};

// ---- One resume at a time per launch ----------------------------------------------

/**
 * The subset of the Web Locks API the launch uses: a non-queuing request. A
 * lock that is not free yields `null` instead of waiting, so a second tab that
 * clicks Continue is told the launch is busy and never queues a second round
 * of starts behind the first.
 */
export interface LaunchLockManager {
  request: <T>(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: Lock | null) => Promise<T>,
  ) => Promise<T>;
}

/** Name of the lock a launch resume holds; distinct from the record's scope lock, so the two never nest. */
export const launchResumeLockName = (scopeKey: string, experimentId: string) =>
  `${scopeKey}:resume:${experimentId}`;

/** How long a storage lease (the fallback without Web Locks) counts as held. */
export const LAUNCH_LEASE_MS = 2 * 60_000;

export type ExclusiveResult<T> = { ran: true; result: T } | { ran: false; reason: 'busy' };

/**
 * Run `task` only if no other tab is resuming the same launch right now.
 *
 * With Web Locks the exclusion holds across tabs. Without them a lease in
 * storage (compare-before-write, expiring after `LAUNCH_LEASE_MS`) narrows the
 * window; it is not atomic, so on such browsers two tabs can still both get
 * through, and the launch then relies on re-reading server state.
 */
export const runExclusiveLaunch = async <T>(
  options: {
    leaseKey: string;
    locks?: LaunchLockManager | null;
    lockName: string;
    now?: () => number;
    storage?: LaunchStorage;
  },
  task: () => Promise<T>,
): Promise<ExclusiveResult<T>> => {
  const { leaseKey, lockName, locks, storage } = options;
  if (locks) {
    // With `ifAvailable`, a lock someone else holds still invokes the callback,
    // with `null` instead of a Lock; the task runs only on a granted lock.
    const held = await locks.request(lockName, { ifAvailable: true }, async (lock) =>
      lock ? { result: await task() } : null,
    );
    return held ? { ran: true, result: held.result } : { ran: false, reason: 'busy' };
  }
  const now = options.now ?? Date.now;
  if (storage) {
    try {
      const lease = Number(storage.getItem(leaseKey));
      if (Number.isFinite(lease) && lease > 0 && now() - lease < LAUNCH_LEASE_MS) {
        return { ran: false, reason: 'busy' };
      }
      storage.setItem(leaseKey, String(now()));
    } catch {
      // No lease possible: run anyway; the server state read inside the task is the last guard.
    }
  }
  try {
    return { ran: true, result: await task() };
  } finally {
    try {
      storage?.removeItem(leaseKey);
    } catch {
      // The lease expires on its own.
    }
  }
};
