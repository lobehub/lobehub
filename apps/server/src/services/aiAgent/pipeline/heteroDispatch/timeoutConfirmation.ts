import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { afterUnscoped } from '@/server/utils/scheduleAfterResponse';

import type { HeteroDispatchDeps, HeteroRun } from './types';
import { failHeteroDispatch } from './utils';

const log = debug('lobe-server:ai-agent-service');

/**
 * How long a run whose device ack timed out may stay unconfirmed before it is
 * settled as the timeout. A device that did receive the request spawns the CLI
 * and lands its first `heteroIngest` well inside this window.
 */
export const HETERO_DISPATCH_CONFIRM_WINDOW_MS = 60_000;

type FailParams = Parameters<typeof failHeteroDispatch>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Settle a timed-out dispatch only if the run never showed up.
 *
 * A device ack timeout does not mean nothing ran: the request may have reached
 * the device over a slow socket, with the ack lost behind it. Failing the run
 * right away settles a CLI that is already starting — its first batch is then
 * refused as `operation-not-running` and the whole turn is thrown away. So the
 * run stays `running` and this waits for the first ingest; only a run nothing
 * touched since dispatch is failed, through the same funnel an immediate
 * dispatch failure uses.
 */
export const confirmTimedOutDispatch = async (
  deps: HeteroDispatchDeps,
  run: HeteroRun,
  params: {
    dispatchedAt: Date;
    finalize: FailParams[2];
    result: FailParams[3];
    wait?: (ms: number) => Promise<void>;
  },
): Promise<'confirmed' | 'failed'> => {
  const { dispatchedAt, finalize, result, wait = sleep } = params;

  await wait(HETERO_DISPATCH_CONFIRM_WINDOW_MS);

  const settled = await new AgentOperationModel(
    deps.db,
    deps.userId,
    deps.workspaceId,
  ).settleUnconfirmedRunning(run.operationId, dispatchedAt);
  if (!settled) {
    log('confirmTimedOutDispatch: op=%s started or settled, keeping it', run.operationId);
    return 'confirmed';
  }

  log('confirmTimedOutDispatch: op=%s never started, failing as timeout', run.operationId);
  await failHeteroDispatch(deps, run, finalize, result);
  return 'failed';
};

/** Run {@link confirmTimedOutDispatch} after the response, off any step's clock. */
export const scheduleTimedOutDispatchConfirmation = (
  deps: HeteroDispatchDeps,
  run: HeteroRun,
  params: Parameters<typeof confirmTimedOutDispatch>[2],
): void => {
  afterUnscoped(() => confirmTimedOutDispatch(deps, run, params));
};
