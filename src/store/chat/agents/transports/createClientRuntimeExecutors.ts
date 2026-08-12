import { createAgentRuntimeExecutors } from '@lobechat/agent-runtime';
import type { ToolsEngine } from '@lobechat/context-engine';
import type { MessageMetadata } from '@lobechat/types';

import type { ResolvedAgentConfig } from '@/services/chat/mecha';
import type { ChatStore } from '@/store/chat/store';

import { buildClientRuntimeHost } from './buildClientRuntimeHost';

/** Resolve a fresh client host for each runtime step, then use the shared package registry. */
export const createClientRuntimeExecutors = (context: {
  agentConfig: ResolvedAgentConfig;
  get: () => ChatStore;
  metadata?: Pick<MessageMetadata, 'trigger'>;
  messageKey: string;
  operationId: string;
  toolsEngine?: ToolsEngine;
}) =>
  createAgentRuntimeExecutors((_instruction, state, runtimeContext) =>
    buildClientRuntimeHost({
      agentConfig: context.agentConfig,
      get: context.get,
      metadata: context.metadata,
      messageKey: context.messageKey,
      operationId: context.operationId,
      runtimeContext,
      stepIndex: state.stepCount,
      toolsEngine: context.toolsEngine,
    }),
  );
