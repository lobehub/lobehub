import type {
  AgentInstruction,
  AgentRuntimeHost,
  InstructionExecutor,
} from '@lobechat/agent-runtime';
import {
  callLlm as createCallLlmExecutor,
  callTool as createCallToolExecutor,
  compressContext as createCompressContextExecutor,
  execSubAgent as createExecSubAgentExecutor,
  execSubAgents as createExecSubAgentsExecutor,
  finish as createFinishExecutor,
  requestHumanApprove as createRequestHumanApproveExecutor,
  resolveAbortedTools as createResolveAbortedToolsExecutor,
} from '@lobechat/agent-runtime';
import { type ToolsEngine } from '@lobechat/context-engine';
import { type MessageMetadata } from '@lobechat/types';

import { type ResolvedAgentConfig } from '@/services/chat/mecha';
import { type ChatStore } from '@/store/chat/store';

import { buildClientRuntimeHost } from './transports/buildClientRuntimeHost';

/** Bind package-hosted executors to the current client runtime host. */
export const createAgentExecutors = (context: {
  agentConfig: ResolvedAgentConfig;
  get: () => ChatStore;
  metadata?: Pick<MessageMetadata, 'trigger'>;
  messageKey: string;
  operationId: string;
  parentId: string;
  toolsEngine?: ToolsEngine;
}) => {
  const usePackageExecutor =
    (factory: (host: AgentRuntimeHost) => InstructionExecutor): InstructionExecutor =>
    (instruction, state, runtimeContext) =>
      factory(
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
      )(instruction, state, runtimeContext);

  const executors: Partial<Record<AgentInstruction['type'], InstructionExecutor>> = {
    call_llm: usePackageExecutor(createCallLlmExecutor),
    call_tool: usePackageExecutor(createCallToolExecutor),
    compress_context: usePackageExecutor(createCompressContextExecutor),
    exec_sub_agent: usePackageExecutor(createExecSubAgentExecutor),
    exec_sub_agents: usePackageExecutor(createExecSubAgentsExecutor),
    finish: usePackageExecutor(createFinishExecutor),
    request_human_approve: usePackageExecutor(createRequestHumanApproveExecutor),
    resolve_aborted_tools: usePackageExecutor(createResolveAbortedToolsExecutor),
  };

  return executors;
};
