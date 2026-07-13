import type { AgentRuntimeHost, OperationStore, StreamSink } from '@lobechat/agent-runtime';

import type { ChatStore } from '@/store/chat/store';

import { ClientMessageTransport } from './ClientMessageTransport';
import { ClientToolTransport } from './ClientToolTransport';

const localOperationStore: OperationStore = {
  clearRunningMark: async () => {},
};

// Client runs consume returned AgentEvents directly. Transport stream output is
// only needed by remote server runs, where it is forwarded through Redis/SSE.
const localStreamSink: StreamSink = {
  publishChunk: async () => {},
  publishEvent: async () => {},
};

export const buildClientRuntimeHost = (context: {
  get: () => ChatStore;
  messageKey: string;
  operationId: string;
  stepIndex: number;
}): AgentRuntimeHost => {
  const runtimeOperation = context.get().operations[context.operationId];
  if (!runtimeOperation) throw new Error(`Operation not found: ${context.operationId}`);

  const { agentId, groupId, scope, subAgentId, threadId, topicId } = runtimeOperation.context;
  const effectiveAgentId = subAgentId && scope !== 'sub_agent' ? subAgentId : agentId;

  return {
    operation: {
      agentId: effectiveAgentId ?? undefined,
      groupId: groupId ?? undefined,
      operationId: context.operationId,
      stepIndex: context.stepIndex,
      threadId: threadId ?? undefined,
      topicId: topicId ?? undefined,
    },
    transports: {
      messages: new ClientMessageTransport(context.get, context.messageKey, context.operationId),
      operationStore: localOperationStore,
      stream: localStreamSink,
      tools: new ClientToolTransport(context.get, context.messageKey, context.operationId),
    },
  };
};
