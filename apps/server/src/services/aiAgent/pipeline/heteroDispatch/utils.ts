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
