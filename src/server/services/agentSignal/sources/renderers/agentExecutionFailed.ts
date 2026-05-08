import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import type { SourceRenderer } from '../types';
import { createBaseSource } from './shared';

export const agentExecutionFailedRenderer = {
  render(input) {
    return {
      ...createBaseSource(input),
      payload: {
        agentId: typeof input.payload.agentId === 'string' ? input.payload.agentId : undefined,
        errorMessage:
          typeof input.payload.errorMessage === 'string'
            ? input.payload.errorMessage
            : typeof input.payload.error === 'string'
              ? input.payload.error
              : undefined,
        operationId: String(input.payload.operationId ?? input.sourceId),
        reason: typeof input.payload.reason === 'string' ? input.payload.reason : undefined,
        serializedContext:
          typeof input.payload.serializedContext === 'string'
            ? input.payload.serializedContext
            : undefined,
        topicId: typeof input.payload.topicId === 'string' ? input.payload.topicId : undefined,
        turnCount:
          typeof input.payload.turnCount === 'number' ? input.payload.turnCount : undefined,
      },
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentExecutionFailed,
    };
  },
  sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentExecutionFailed,
} satisfies SourceRenderer;
