import type { DeviceUnavailableErrorData, ErrorType, ExecAgentResult } from '@lobechat/types';

import type { DeviceDispatchRoute } from '../../helpers/heteroErrors';
import { finalizeHeteroDispatchError } from '../finalizeHeteroDispatchError';
import type { HeteroDispatchDeps, HeteroRun } from './types';

/** The terminal error result a dispatch returns instead of starting the run. */
export const heteroErrorResult = (
  run: HeteroRun,
  fields: {
    error?: string;
    errorData?: DeviceUnavailableErrorData;
    message: string;
    terminalReported: boolean;
  },
): ExecAgentResult => ({
  agentId: run.agentId,
  assistantMessageId: run.assistantMessageId,
  autoStarted: false,
  createdAt: new Date().toISOString(),
  ...fields,
  operationId: run.operationId,
  status: 'error',
  success: false,
  timestamp: new Date().toISOString(),
  topicId: run.topicId,
  userMessageId: run.userMessageId,
});

/**
 * Settle a dispatch that failed before the agent started (see
 * `finalizeHeteroDispatchError`) and build the error result the caller returns.
 */
export const failHeteroDispatch = async (
  deps: HeteroDispatchDeps,
  run: HeteroRun,
  finalize: {
    detail: string;
    deviceRoute?: DeviceDispatchRoute;
    errorData?: DeviceUnavailableErrorData;
    errorType?: ErrorType;
    message: string;
  },
  result: { error?: string; errorData?: DeviceUnavailableErrorData; message: string },
): Promise<ExecAgentResult> => {
  const terminalReported = await finalizeHeteroDispatchError(deps, {
    agentId: run.agentId,
    assistantMessageId: run.assistantMessageId,
    ...finalize,
    operationId: run.operationId,
    topicId: run.topicId,
  });
  return heteroErrorResult(run, { ...result, terminalReported });
};

/**
 * `Promise.all` for reads that used to run one after another: waits for every
 * one to settle, then rethrows the first failure in ARGUMENT order, so the
 * error a caller sees is the one the sequential code would have hit first.
 * Nothing is left running unobserved when one of them fails.
 */
export const settleInOrder = async <T extends readonly unknown[] | []>(
  promises: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> => {
  const settled = await Promise.allSettled(promises as readonly Promise<unknown>[]);
  const values: unknown[] = [];
  for (const result of settled) {
    if (result.status === 'rejected') throw result.reason;
    values.push(result.value);
  }
  return values as { -readonly [K in keyof T]: Awaited<T[K]> };
};
