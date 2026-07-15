import type {
  AgentRuntimeContext,
  AgentRuntimeHost,
  AgentState,
  OperationStore,
} from '@lobechat/agent-runtime';
import type { ToolsEngine } from '@lobechat/context-engine';
import type { MessageMetadata } from '@lobechat/types';

import type { ResolvedAgentConfig } from '@/services/chat/mecha';
import type { ChatStore } from '@/store/chat/store';

import { ClientCompressionTransport } from './ClientCompressionTransport';
import { ClientContextBuilder } from './ClientContextBuilder';
import { ClientLLMTransport } from './ClientLLMTransport';
import { ClientMessageTransport } from './ClientMessageTransport';
import { type ClientRuntimeSession, ClientRuntimeStreamSink } from './ClientRuntimeStreamSink';
import { ClientSubAgentTransport } from './ClientSubAgentTransport';
import { ClientToolTransport } from './ClientToolTransport';

export const buildClientRuntimeHost = (context: {
  agentConfig: ResolvedAgentConfig;
  get: () => ChatStore;
  metadata?: Pick<MessageMetadata, 'trigger'>;
  messageKey: string;
  operationId: string;
  runtimeContext?: AgentRuntimeContext;
  stepIndex: number;
  toolsEngine?: ToolsEngine;
}): AgentRuntimeHost => {
  const runtimeOperation = context.get().operations[context.operationId];
  if (!runtimeOperation) throw new Error(`Operation not found: ${context.operationId}`);

  const { agentId, groupId, scope, subAgentId, threadId, topicId } = runtimeOperation.context;
  const effectiveAgentId = subAgentId && scope !== 'sub_agent' ? subAgentId : agentId;
  const messages = new ClientMessageTransport(context.get, context.messageKey, context.operationId);
  const session: ClientRuntimeSession = {};
  const stream = new ClientRuntimeStreamSink(context.get, context.operationId, session);
  const operationStore: OperationStore = {
    clearRunningMark: async () => {},
    loadState: async (operationId) => {
      const operation = context.get().operations[operationId];
      if (operation?.status !== 'cancelled') return null;

      return { status: 'interrupted' } as AgentState;
    },
  };

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
      compression: new ClientCompressionTransport(
        context.get,
        context.messageKey,
        context.operationId,
      ),
      context: new ClientContextBuilder({
        agentConfig: context.agentConfig,
        get: context.get,
        metadata: context.metadata,
        operationId: context.operationId,
        runtimeContext: context.runtimeContext,
        toolsEngine: context.toolsEngine,
      }),
      llm: new ClientLLMTransport({
        get: context.get,
        metadata: context.metadata,
        operationId: context.operationId,
        session,
      }),
      messages,
      operationStore,
      stream,
      subAgent: new ClientSubAgentTransport(context.get, context.operationId),
      tools: new ClientToolTransport(
        context.get,
        context.messageKey,
        context.operationId,
        messages,
      ),
    },
  };
};
