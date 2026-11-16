import { randomUUID } from 'node:crypto';

import debug from 'debug';

import { redisService } from '@/server/services/redis';
import {
  HETERO_CONTROL_MAX_TTL_MS,
  type HeteroControlMessage,
  type HeteroControlReport,
  type HeteroControlReportOutcome,
  type HeteroControlState,
} from '@/server/services/redis/heteroControl';

export type {
  HeteroControlMessage,
  HeteroControlReport,
  HeteroControlState,
} from '@/server/services/redis/heteroControl';

const log = debug('lobe-server:steer-queue:hetero-control');

/**
 * How long a control message waits for the run's poller by default. A live
 * poller re-checks every couple of seconds, so a run that takes control
 * messages claims one well within it.
 */
export const HETERO_CONTROL_DEFAULT_TTL_MS = 30 * 1000;

const WAIT_POLL_MS = 300;

/** The message reached an end: the run reported, or nobody claimed it in time. */
export const isHeteroControlSettled = (state: HeteroControlState | undefined): boolean =>
  !!state && state.status !== 'pending' && state.status !== 'claimed';

/**
 * Queue a control command for a running heterogeneous agent session (Claude
 * Code through `lh hetero exec`). The run's `waitHeteroSteer` poll hands it to
 * the command handler registered under `command` in the CLI, which reports
 * back through `aiAgent.reportHeteroControlResult`.
 *
 * Server-internal: the caller owns authorization of `operationId`.
 *
 * A run whose `lh` predates control messages never claims it: it reads
 * `expired` once `ttlMs` passes. A run without a handler for `command` reports
 * `unsupported`.
 *
 * @returns the control message id, for {@link readHeteroControlResult} /
 * {@link waitHeteroControlResult}
 * @throws when Redis is unavailable
 */
export const enqueueHeteroControl = async (
  operationId: string,
  command: string,
  params?: unknown,
  options: { ttlMs?: number } = {},
): Promise<string> => {
  if (!command) throw new Error('A control message needs a command');
  const ttlMs = Math.min(
    Math.max(options.ttlMs ?? HETERO_CONTROL_DEFAULT_TTL_MS, 1),
    HETERO_CONTROL_MAX_TTL_MS,
  );

  const now = Date.now();
  const message: HeteroControlMessage = {
    command,
    createdAt: now,
    id: randomUUID(),
    params: params ?? null,
  };
  await redisService.heteroControl.enqueue(operationId, message, now + ttlMs);
  log('[%s] Queued control %s (%s)', operationId, message.id, command);
  return message.id;
};

/**
 * Where a control message stands now; `undefined` for an id this run never
 * queued (or whose state already expired), or without Redis.
 */
export const readHeteroControlResult = (
  operationId: string,
  id: string,
): Promise<HeteroControlState | undefined> => redisService.heteroControl.read(operationId, id);

/**
 * Wait until a control message settles (see {@link isHeteroControlSettled})
 * or `timeoutMs` passes.
 *
 * @returns the last state read: `claimed` at the timeout means the run took
 * the message but has not reported (it may still be handling it, or died with
 * it — a claimed message is never handed out again)
 */
export const waitHeteroControlResult = async (
  operationId: string,
  id: string,
  options: { pollMs?: number; timeoutMs: number },
): Promise<HeteroControlState | undefined> => {
  const deadline = Date.now() + options.timeoutMs;
  const pollMs = options.pollMs ?? WAIT_POLL_MS;
  for (;;) {
    const state = await readHeteroControlResult(operationId, id);
    if (isHeteroControlSettled(state) || !state) return state;
    const left = deadline - Date.now();
    if (left <= 0) return state;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, left)));
  }
};

/**
 * {@link enqueueHeteroControl} and wait for its result in one call. The
 * message expires when the wait ends, so an unclaimed one settles as
 * `expired` rather than running after the caller gave up.
 */
export const sendHeteroControl = async (
  operationId: string,
  command: string,
  params: unknown,
  options: { pollMs?: number; timeoutMs: number },
): Promise<{ id: string; state: HeteroControlState | undefined }> => {
  const id = await enqueueHeteroControl(operationId, command, params, {
    ttlMs: options.timeoutMs,
  });
  const state = await waitHeteroControlResult(operationId, id, options);
  return { id, state };
};

/**
 * Take the run's next control message for its poller. Called only for a
 * poller that declared `acceptsControl`; at most once per message.
 */
export const takeHeteroControl = async (
  operationId: string,
): Promise<HeteroControlMessage | undefined> => {
  const message = await redisService.heteroControl.claim(operationId);
  if (message) log('[%s] Delivering control %s (%s)', operationId, message.id, message.command);
  return message;
};

/** Store what the run reported for a control message it claimed. */
export const reportHeteroControlResult = async (
  operationId: string,
  id: string,
  report: HeteroControlReport,
): Promise<HeteroControlReportOutcome> => {
  const outcome = await redisService.heteroControl.report(operationId, id, report);
  if (outcome !== 'recorded') {
    log('[%s] Ignored control result %s (%s): %s', operationId, id, report.status, outcome);
  }
  return outcome;
};
