import { type AgentState, createAgentRuntimeExecutors } from '@lobechat/agent-runtime';
import type { ToolsEngine } from '@lobechat/context-engine';
import type { LobeAgentConfig, MessageMetadata } from '@lobechat/types';

import type { ResolvedAgentConfig } from '@/services/chat/mecha';
import type { ChatStore } from '@/store/chat/store';

import { buildClientRuntimeHost } from './buildClientRuntimeHost';
import { prepareClientMcpTools } from './handoffClientMcpTools';

/** Resolve a fresh client host for each runtime step, then use the shared package registry. */
export const createClientRuntimeExecutors = (context: {
  agentConfig: ResolvedAgentConfig;
  get: () => ChatStore;
  metadata?: Pick<MessageMetadata, 'trigger'>;
  messageKey: string;
  operationId: string;
  toolsEngine?: ToolsEngine;
}) => {
  const resolveHost = (
    _instruction: Parameters<typeof prepareClientMcpTools>[1],
    state: AgentState,
    runtimeContext?: Parameters<typeof buildClientRuntimeHost>[0]['runtimeContext'],
  ) =>
    buildClientRuntimeHost({
      agentConfig: context.agentConfig,
      get: context.get,
      metadata: context.metadata,
      messageKey: context.messageKey,
      operationId: context.operationId,
      runtimeContext,
      stepIndex: state.stepCount,
      toolsEngine: context.toolsEngine,
    });
  const executors = createAgentRuntimeExecutors(resolveHost);
  for (const type of ['call_tool', 'call_tools_batch'] as const) {
    const execute = executors[type]!;
    executors[type] = async (instruction, state, runtimeContext) => {
      const prepared = await prepareClientMcpTools(
        resolveHost(instruction, state, runtimeContext),
        instruction,
        context.get,
        (state.world?.agent as LobeAgentConfig | undefined)?.chatConfig?.toolResultMaxLength ??
          context.agentConfig.chatConfig?.toolResultMaxLength,
      );
      return execute(prepared, state, runtimeContext);
    };
  }
  return executors;
};
