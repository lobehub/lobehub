import type { AgentInstruction, InstructionExecutor } from '@lobechat/agent-runtime';
import {
  callLlm as createCallLlmExecutor,
  callTool as createCallToolExecutor,
  callToolsBatch as createCallToolsBatchExecutor,
  compressContext as createCompressContextExecutor,
  execSubAgent as createExecSubAgentExecutor,
  execSubAgents as createExecSubAgentsExecutor,
  finish as createFinishExecutor,
  requestHumanApprove as createRequestHumanApproveExecutor,
  resolveAbortedTools as createResolveAbortedToolsExecutor,
  resolveBlockedTools as createResolveBlockedToolsExecutor,
} from '@lobechat/agent-runtime';

import { buildHost } from './buildHost';
import type { RuntimeExecutorContext } from './context';

export { type RuntimeExecutorContext } from './context';

export const createRuntimeExecutors = (
  ctx: RuntimeExecutorContext,
): Partial<Record<AgentInstruction['type'], InstructionExecutor>> => {
  // Package-hosted executors take an AgentRuntimeHost (transport adapters +
  // operation context) instead of the raw server ctx. Built once per operation.
  const host = buildHost(ctx);

  return {
    call_llm: createCallLlmExecutor(host),
    call_tool: createCallToolExecutor(host),
    call_tools_batch: createCallToolsBatchExecutor(host),
    compress_context: createCompressContextExecutor(host),
    exec_sub_agent: createExecSubAgentExecutor(host),
    exec_sub_agents: createExecSubAgentsExecutor(host),
    // Migrated into @lobechat/agent-runtime as part of the IO transport port
    // abstraction — the server now only registers adapters via buildHost.
    finish: createFinishExecutor(host),
    request_human_approve: createRequestHumanApproveExecutor(host),
    resolve_aborted_tools: createResolveAbortedToolsExecutor(host),
    resolve_blocked_tools: createResolveBlockedToolsExecutor(host),
  };
};
