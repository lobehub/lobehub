import { AGENT_SIGNAL_SOURCE_TYPES } from '../../sourceTypes';
import type { SourceRenderer } from '../types';
import { createBaseSource } from './shared';

export const agentUserMessageRenderer = {
  render(input) {
    return {
      ...createBaseSource(input),
      payload: {
        agentId: typeof input.payload.agentId === 'string' ? input.payload.agentId : undefined,
        documentPayload:
          input.payload.documentPayload && typeof input.payload.documentPayload === 'object'
            ? (input.payload.documentPayload as Record<string, unknown>)
            : undefined,
        intents: Array.isArray(input.payload.intents)
          ? input.payload.intents.filter(
              (intent): intent is 'document' | 'memory' | 'persona' | 'prompt' =>
                intent === 'document' ||
                intent === 'memory' ||
                intent === 'persona' ||
                intent === 'prompt',
            )
          : undefined,
        memoryPayload:
          input.payload.memoryPayload && typeof input.payload.memoryPayload === 'object'
            ? (input.payload.memoryPayload as Record<string, unknown>)
            : undefined,
        message:
          typeof input.payload.message === 'string'
            ? input.payload.message
            : typeof input.payload.prompt === 'string'
              ? input.payload.prompt
              : '',
        messageId:
          typeof input.payload.messageId === 'string'
            ? input.payload.messageId
            : typeof input.payload.userMessageId === 'string'
              ? input.payload.userMessageId
              : input.sourceId,
        serializedContext:
          typeof input.payload.serializedContext === 'string'
            ? input.payload.serializedContext
            : undefined,
        threadId: typeof input.payload.threadId === 'string' ? input.payload.threadId : undefined,
        topicId: typeof input.payload.topicId === 'string' ? input.payload.topicId : undefined,
        trigger: typeof input.payload.trigger === 'string' ? input.payload.trigger : undefined,
      },
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage,
    };
  },
  sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentUserMessage,
} satisfies SourceRenderer;
