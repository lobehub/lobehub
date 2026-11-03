import type { EvalConnectorBindings } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import {
  type AgentEvalConnectorService,
  EvalConnectorBindingError,
} from '@/server/services/agentEvalConnector';

export const validateEvalConnectorBindings = async (
  service: Pick<AgentEvalConnectorService, 'validateBindings'>,
  bindings?: EvalConnectorBindings,
) => {
  if (!bindings) return;
  try {
    await service.validateBindings(bindings);
  } catch (error) {
    if (error instanceof EvalConnectorBindingError) {
      throw new TRPCError({ code: error.code, message: error.message });
    }
    throw error;
  }
};
