import { AGENT_SIGNAL_SOURCE_TYPES } from '../../sourceTypes';
import type { SourceRenderer } from '../types';
import { createBaseSource } from './shared';

export const runtimeBeforeStepRenderer = {
  render(input) {
    return {
      ...createBaseSource(input),
      payload: {
        agentId: typeof input.payload.agentId === 'string' ? input.payload.agentId : undefined,
        operationId: String(input.payload.operationId ?? input.sourceId),
        serializedContext:
          typeof input.payload.serializedContext === 'string'
            ? input.payload.serializedContext
            : undefined,
        stepIndex: typeof input.payload.stepIndex === 'number' ? input.payload.stepIndex : 0,
        topicId: typeof input.payload.topicId === 'string' ? input.payload.topicId : undefined,
        turnCount:
          typeof input.payload.turnCount === 'number' ? input.payload.turnCount : undefined,
      },
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.runtimeBeforeStep,
    };
  },
  sourceType: AGENT_SIGNAL_SOURCE_TYPES.runtimeBeforeStep,
} satisfies SourceRenderer;
