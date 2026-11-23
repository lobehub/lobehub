import {
  type FileTaskAdmissionDecision,
  recordFileTaskAdmission,
} from '@lobechat/observability-otel/modules/file-task-admission';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { fileEnv } from '@/envs/file';
import { getRedisConfig } from '@/envs/redis';
import { OtelQstashClient } from '@/libs/qstash';
import { redisService } from '@/server/services/redis';
import type { FileTaskSlotAcquireResult } from '@/server/services/redis/fileTaskSlots';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';

import { triggerFileTask } from './trigger';
import type { FileTaskAdmission, FileTaskRef } from './types';

export { prepareFileTaskTrigger, triggerFileTask } from './trigger';
export type { FileTaskAdmission, FileTaskKind, FileTaskRef } from './types';

/** Lapses within minutes when a function dies; a live task renews it. */
const LEASE_TTL_MS = 180_000;
const LEASE_RENEW_MS = 60_000;
/**
 * How long the status poll leaves a queued task alone. It has to cover a large import draining
 * at the workspace limit; past it, a task whose message was lost surfaces as a retryable timeout.
 */
const QUEUE_DEADLINE_MS = 24 * 60 * 60 * 1000;
/** One delivery stays well inside the function limit, whether it waits for a slot or a task. */
const DELIVERY_BUDGET_MS = 50_000;
/** Keeps the function alive long enough for a late-admitted request to leave. */
const MIN_TRIGGER_HOLD_MS = 5000;
const SLOT_POLL_MS = 2000;
const REQUEUE_DELAY_SECONDS = 10;

export const FILE_TASK_QUEUE_RETRIES = 5;

const QUEUE_PATH = '/api/workflows/file-task/dispatch';
const TRIGGER_ERROR_MESSAGE =
  'trigger chunk embedding async task error. Please make sure the APP_URL is available from your server. You can check the proxy config or WAF blocking';

const getBaseUrl = () => appEnv.INTERNAL_APP_URL || appEnv.APP_URL;

const getLimits = () => ({
  globalLimit: fileEnv.FILE_TASK_GLOBAL_CONCURRENCY,
  scopeLimit: fileEnv.FILE_TASK_WORKSPACE_CONCURRENCY,
  ttlMs: LEASE_TTL_MS,
});

/**
 * Needs both Redis (the counters) and QStash (somewhere durable to wait). Without them, as on
 * most self-hosted servers, tasks start directly and the per-process parse queue applies.
 * Setting either limit to 0 turns admission off.
 */
export const isFileTaskAdmissionEnabled = () => {
  const { globalLimit, scopeLimit } = getLimits();

  return (
    scopeLimit > 0 &&
    globalLimit > 0 &&
    Boolean(process.env.QSTASH_TOKEN) &&
    Boolean(getBaseUrl()) &&
    getRedisConfig().enabled
  );
};

export const getFileTaskScope = (userId: string, workspaceId?: string) =>
  workspaceId ? `workspace:${workspaceId}` : `user:${userId}`;

const report = (
  decision: FileTaskAdmissionDecision,
  task: FileTaskRef,
  active: { globalActive?: number; scopeActive?: number } = {},
) => {
  recordFileTaskAdmission({ decision, globalActive: active.globalActive, kind: task.kind });

  const { globalLimit, scopeLimit } = getLimits();
  console.info(
    JSON.stringify({
      decision,
      event: 'file_task.admission',
      fileId: task.fileId,
      globalActive: active.globalActive,
      globalLimit,
      kind: task.kind,
      scope: getFileTaskScope(task.userId, task.workspaceId),
      scopeActive: active.scopeActive,
      scopeLimit,
      taskId: task.taskId,
    }),
  );
};

const queueDeadline = () => new Date(Date.now() + QUEUE_DEADLINE_MS);

const publishQueuedFileTask = async (task: FileTaskRef, delaySeconds?: number) => {
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const scope = getFileTaskScope(task.userId, task.workspaceId);

  await new OtelQstashClient({ token: process.env.QSTASH_TOKEN! }).publishJSON({
    body: task,
    ...(delaySeconds ? { delay: delaySeconds } : {}),
    // Paces a queued import without polling. While Redis is down this is the only limit left: it
    // caps deliveries in progress, so it bounds how fast tasks start rather than how many run.
    flowControl: {
      key: `file-task.${scope.replace(':', '.')}`,
      parallelism: fileEnv.FILE_TASK_WORKSPACE_CONCURRENCY,
    },
    ...(bypassSecret ? { headers: { 'x-vercel-protection-bypass': bypassSecret } } : {}),
    retries: FILE_TASK_QUEUE_RETRIES,
    url: new URL(QUEUE_PATH, getBaseUrl()).toString(),
  });
};

/**
 * Decides whether a new file task starts now or waits in the queue. Under the limits the caller
 * triggers it directly, so a single upload takes no extra hop. Throws when the task could not be
 * queued: the caller then records the failure, which the user can retry.
 */
export const admitFileTask = async (
  task: FileTaskRef,
  asyncTaskModel: AsyncTaskModel,
): Promise<FileTaskAdmission> => {
  if (!isFileTaskAdmissionEnabled()) return { queued: false };

  const scope = getFileTaskScope(task.userId, task.workspaceId);
  const lease = await redisService.fileTaskSlots.acquire(scope, task.taskId, getLimits());

  if (lease.status === 'acquired' || lease.status === 'held') {
    report('admitted', task, lease);
    return { admissionScope: scope, queued: false };
  }

  // Written before publishing: a delivery can arrive before the publish call returns.
  await asyncTaskModel.markFileTaskQueued(task.taskId, queueDeadline());
  await publishQueuedFileTask(task);
  report('queued', task, lease.status === 'full' ? lease : undefined);

  return { queued: true };
};

export const releaseFileTaskAdmission = (scope: string | undefined, taskId: string) =>
  scope ? redisService.fileTaskSlots.release(scope, taskId) : Promise.resolve();

/** Holds the task's slot for as long as the async route runs it. */
export const holdFileTaskLease = async <T>(
  input: { admissionScope?: string; taskId?: string } | undefined,
  run: () => Promise<T>,
): Promise<T> => {
  const scope = input?.admissionScope;
  const taskId = input?.taskId;
  if (!scope || !taskId) return run();

  const heartbeat = setInterval(() => {
    void redisService.fileTaskSlots.renew(scope, taskId, LEASE_TTL_MS);
  }, LEASE_RENEW_MS);
  heartbeat.unref?.();

  try {
    return await run();
  } finally {
    clearInterval(heartbeat);
    await redisService.fileTaskSlots.release(scope, taskId);
  }
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Without a response status the request never got an answer; these statuses mean it never ran. */
const neverStarted = (error: unknown) => {
  const { data, meta } = error as {
    data?: { httpStatus?: number };
    meta?: { response?: { status?: number } };
  };
  const status = data?.httpStatus ?? meta?.response?.status;

  return status === undefined || status === 429 || status === 502 || status === 503;
};

const isSettled = (status?: string | null) =>
  status === AsyncTaskStatus.Success || status === AsyncTaskStatus.Error;

export type QueuedFileTaskOutcome = 'deferred' | 'failed' | 'skipped' | 'started';

/**
 * Runs one queue delivery. QStash delivers at least once, so the database claim decides which
 * delivery starts the task. Throwing asks QStash to redeliver.
 */
export const processQueuedFileTask = async (
  task: FileTaskRef,
  { finalAttempt }: { finalAttempt: boolean },
): Promise<QueuedFileTaskOutcome> => {
  const db = await getServerDB();
  const asyncTaskModel = new AsyncTaskModel(db, task.userId, task.workspaceId);

  const current = await asyncTaskModel.findById(task.taskId);
  const queuedUntil = (current?.metadata as { fileTaskQueuedUntil?: string } | null)
    ?.fileTaskQueuedUntil;
  if (!current || !queuedUntil || isSettled(current.status)) return 'skipped';

  const scope = getFileTaskScope(task.userId, task.workspaceId);
  const deadline = Date.now() + DELIVERY_BUDGET_MS;

  // Turning admission off has to drain what is already queued: a limit of 0 would never admit it.
  const acquireSlot = async (): Promise<FileTaskSlotAcquireResult> =>
    isFileTaskAdmissionEnabled()
      ? redisService.fileTaskSlots.acquire(scope, task.taskId, getLimits())
      : { status: 'unavailable' };

  // Waiting here keeps this delivery's flow-control slot, so a full workspace does not cycle its
  // whole backlog through QStash.
  let lease = await acquireSlot();
  while (lease.status === 'full' && Date.now() < deadline) {
    await sleep(SLOT_POLL_MS + Math.random() * 500);
    lease = await acquireSlot();
  }

  if (lease.status === 'full') {
    await asyncTaskModel.markFileTaskQueued(task.taskId, queueDeadline());
    await publishQueuedFileTask(task, REQUEUE_DELAY_SECONDS);
    report('deferred', task, lease);
    return 'deferred';
  }

  // A lost claim leaves the lease alone: the delivery that won may be running under it.
  if (!(await asyncTaskModel.claimQueuedFileTask(task.taskId))) return 'skipped';

  const admissionScope = lease.status === 'unavailable' ? undefined : scope;
  report('dequeued', task, lease.status === 'unavailable' ? undefined : lease);

  let holdTimer: NodeJS.Timeout | undefined;
  const outcome = await Promise.race([
    triggerFileTask({ ...task, admissionScope }).then(
      () => ({ failed: false as const }),
      (error: unknown) => ({ error, failed: true as const }),
    ),
    // A long task outlives this delivery: the async route keeps running and holds the lease.
    new Promise<{ failed: false }>((resolve) => {
      holdTimer = setTimeout(
        () => resolve({ failed: false }),
        Math.max(deadline - Date.now(), MIN_TRIGGER_HOLD_MS),
      );
    }),
  ]);
  clearTimeout(holdTimer);

  if (!outcome.failed) return 'started';

  await releaseFileTaskAdmission(admissionScope, task.taskId);

  // The route ran and recorded its own result (for example, a full vector quota).
  const latest = await asyncTaskModel.findById(task.taskId);
  if (!latest || isSettled(latest.status)) return 'failed';

  if (!finalAttempt && neverStarted(outcome.error)) {
    await asyncTaskModel.markFileTaskQueued(task.taskId, queueDeadline());
    throw outcome.error;
  }

  console.error('[fileTaskAdmission] trigger failed:', outcome.error);
  await asyncTaskModel.update(task.taskId, {
    error: new AsyncTaskError(AsyncTaskErrorType.TaskTriggerError, TRIGGER_ERROR_MESSAGE),
    status: AsyncTaskStatus.Error,
  });
  report('rejected', task);

  return 'failed';
};
