import type { EvalConnectorBindings } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import {
  type AgentEvalConnectorService,
  EvalConnectorBindingError,
} from '@/server/services/agentEvalConnector';

export const validateEvalConnectorBindings = async (
  serviceForDataset: (datasetId: string) => Pick<AgentEvalConnectorService, 'validateBindings'>,
  bindings?: EvalConnectorBindings,
  datasetId?: string,
) => {
  if (!bindings || !Object.keys(bindings).length) return;
  if (!datasetId)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Manage evaluation connections within their Dataset.',
    });
  try {
    await serviceForDataset(datasetId).validateBindings(bindings);
  } catch (error) {
    if (error instanceof EvalConnectorBindingError) {
      throw new TRPCError({ code: error.code, message: error.message });
    }
    throw error;
  }
};
