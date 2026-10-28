import type { AgentState } from '@lobechat/agent-runtime';
import debug from 'debug';

import type { AgentOperationModel } from '@/database/models/agentOperation';

const log = debug('lobe-server:agent-runtime-service');

export const isTerminalAgentStatus = (status: AgentState['status'] | undefined) =>
  status === 'done' || status === 'error' || status === 'interrupted';

/**
 * The durable operation row's status when it is terminal, else `undefined`.
 * Redis keeps the resumable step state, but the row is the authority for
 * cancellation, abandonment and recovery. A read failure preserves runtime
 * availability: it reads as not terminal, and the step lock and the normal
 * persistence path still apply.
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
  }
  return undefined;
};
