import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import type { SourceRenderer } from '../types';
import { createBaseSource } from './shared';

export const agentExecutionCompletedRenderer = {
  render(input) {
    return {
      ...createBaseSource(input),
      payload: {
        agentId: typeof input.payload.agentId === 'string' ? input.payload.agentId : undefined,
        operationId: String(input.payload.operationId ?? input.sourceId),
        // Compact self-iteration tool outcomes extracted from finalState by the
        // completion lifecycle. Opaque here (validated downstream); MUST be
        // carried through so the completion policy can project receipts/briefs.
        selfIteration: input.payload.selfIteration,
        serializedContext:
          typeof input.payload.serializedContext === 'string'
            ? input.payload.serializedContext
            : undefined,
        steps:
          typeof input.payload.steps === 'number'
            ? input.payload.steps
            : typeof input.payload.stepCount === 'number'
              ? input.payload.stepCount
              : 0,
        topicId: typeof input.payload.topicId === 'string' ? input.payload.topicId : undefined,
        turnCount:
          typeof input.payload.turnCount === 'number' ? input.payload.turnCount : undefined,
      },
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentExecutionCompleted,
    };
  },
  sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentExecutionCompleted,
} satisfies SourceRenderer;
