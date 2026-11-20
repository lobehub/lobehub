import type { AgentState } from '@lobechat/agent-runtime';
import debug from 'debug';

import type { AgentOperationModel } from '@/database/models/agentOperation';

import { DurableStatusUnavailableError } from './executionErrors';

const log = debug('lobe-server:agent-runtime-service');

export const isTerminalAgentStatus = (status: AgentState['status'] | undefined) =>
  status === 'done' || status === 'error' || status === 'interrupted';

/**
 * The durable operation row's status when it is terminal, else `undefined`.
 * Redis keeps the resumable step state, but the row is the authority for
 * cancellation, abandonment and recovery. A read failure refuses execution
 * with `DurableStatusUnavailableError`: the step neither runs nor settles the
 * run, and a queue retry re-checks the row before spending on models or tools.
 */
export const loadTerminalDurableStatus = async (
  agentOperationModel: AgentOperationModel,
  operationId: string,
  stepIndex: number,
): Promise<'abandoned' | 'done' | 'error' | 'interrupted' | undefined> => {
  try {
    const status = (await agentOperationModel.findById(operationId))?.status;
    if (
      status === 'done' ||
      status === 'error' ||
      status === 'interrupted' ||
      status === 'abandoned'
    ) {
      return status;
    }
  } catch (error) {
    log('[%s][%d] Durable operation status check failed: %O', operationId, stepIndex, error);
    throw new DurableStatusUnavailableError(operationId, stepIndex, { cause: error });
  }
  return undefined;
};
