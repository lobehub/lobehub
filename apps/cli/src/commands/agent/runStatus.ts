import type { getTrpcClient } from '../../api/client';
import type { AgentRunOutcome } from '../../utils/agentRunOutcome';
import {
  classifyRunStatus,
  colorStatus,
  describeOutcome,
  readOperationStatus,
} from '../../utils/agentRunOutcome';
import { log } from '../../utils/logger';

type TrpcClient = Awaited<ReturnType<typeof getTrpcClient>>;

export const RUN_POLL_INTERVAL_MS = 10_000;
/** Upper bound for one status request, so a hung request cannot stall the wait. */
export const RUN_STATUS_REQUEST_TIMEOUT_MS = 30_000;
/** Consecutive failed / unreadable answers tolerated before giving up. */
export const RUN_STATUS_MAX_MISSES = 3;

interface StatusOptions {
  /** `--json` keeps stdout for the event array, so progress goes to stderr */
  json?: boolean;
  requestTimeoutMs?: number;
}

interface PollOptions extends StatusOptions {
  intervalMs?: number;
  maxMisses?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const info = (json: boolean | undefined, msg: string) => {
  if (json) console.error(msg);
  else log.info(msg);
};

const MISSING_RESULT_MESSAGE =
  "The server returned no status for this operation (unknown id, not visible to this account, or its run state already expired) — the run's outcome cannot be confirmed.";

/**
 * Query `getOperationStatus` with a hard deadline. The abort signal cancels
 * the request; the race guarantees the deadline even if a transport ignores it.
 */
export const queryOperationStatus = async (
  client: TrpcClient,
  operationId: string,
  timeoutMs = RUN_STATUS_REQUEST_TIMEOUT_MS,
): Promise<any> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`status request got no answer within ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      client.aiAgent.getOperationStatus.query({ operationId } as any, {
        signal: controller.signal,
      }),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * One status check while the live stream is still open but quiet. Returns the
 * outcome once the run has ended, `undefined` while it is still active, and
 * throws when the status cannot be fetched (the caller falls back to polling).
 */
export const probeRunOutcome = async (
  client: TrpcClient,
  operationId: string,
  options: StatusOptions = {},
): Promise<AgentRunOutcome | undefined> => {
  const r = await queryOperationStatus(client, operationId, options.requestTimeoutMs);
  if (!r) {
    log.error(MISSING_RESULT_MESSAGE);
    return { kind: 'unknown' };
  }

  const read = readOperationStatus(r);
  const kind = classifyRunStatus(read.status);
  if (kind === 'active') return undefined;
  // Never guess an outcome from an answer it cannot read: hand over to the
  // poller, which gives up loudly if the shape stays unreadable.
  if (!kind) throw new Error(`unreadable run status (${read.status ?? 'none'})`);
  return { error: read.error, kind, status: read.status };
};

/**
 * Fallback when the live stream (gateway WebSocket / SSE) is unavailable or
 * ended without a terminal event: the run may still be executing server-side,
 * so poll its status until it reaches a terminal state.
 *
 * Never reports success it cannot see: failure / interruption statuses come
 * back as such, and a missing, unreadable or unreachable status ends as
 * `unknown` instead of being read as "finished".
 */
export const pollAgentRunStatus = async (
  client: TrpcClient,
  operationId: string,
  options: PollOptions = {},
): Promise<AgentRunOutcome> => {
  const {
    intervalMs = RUN_POLL_INTERVAL_MS,
    json,
    maxMisses = RUN_STATUS_MAX_MISSES,
    requestTimeoutMs,
  } = options;

  const finish = (outcome: AgentRunOutcome): AgentRunOutcome => {
    if (!json) {
      console.log();
      console.log(describeOutcome(outcome));
    }
    return outcome;
  };

  let lastStatus = '';
  let failures = 0;
  let unreadable = 0;

  for (let i = 0; ; i++) {
    if (i > 0) await sleep(intervalMs);

    let r: any;
    try {
      r = await queryOperationStatus(client, operationId, requestTimeoutMs);
      failures = 0;
    } catch (error) {
      failures++;
      log.warn(`Status poll failed (${failures}/${maxMisses}): ${(error as Error).message}`);
      if (failures >= maxMisses) {
        log.error('Giving up on the run status; the run may still be executing server-side.');
        return finish({ error: (error as Error).message, kind: 'unknown' });
      }
      continue;
    }

    if (!r) {
      log.error(MISSING_RESULT_MESSAGE);
      return finish({ kind: 'unknown' });
    }

    const read = readOperationStatus(r);
    const kind = classifyRunStatus(read.status);

    if (!kind) {
      unreadable++;
      if (unreadable >= maxMisses) {
        const keys = typeof r === 'object' ? Object.keys(r).join(', ') : typeof r;
        log.error(
          `Could not read a run status from the server's answer (status: ${read.status ?? 'none'}; keys: ${keys}).`,
        );
        return finish({ kind: 'unknown', status: read.status });
      }
      continue;
    }
    unreadable = 0;

    if (read.status !== lastStatus) {
      lastStatus = read.status!;
      const steps = read.stepCount !== undefined ? ` · ${read.stepCount} step(s)` : '';
      info(json, `Run status: ${colorStatus(read.status!)}${steps}`);
    }

    if (kind !== 'active') {
      if (read.error) log.error(`Run error: ${read.error}`);
      return finish({ error: read.error, kind, status: read.status });
    }
  }
};
