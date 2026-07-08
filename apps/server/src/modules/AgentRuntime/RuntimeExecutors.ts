import type { AgentInstruction, InstructionExecutor } from '@lobechat/agent-runtime';
import {
  callTool as createCallToolExecutor,
  callToolsBatch as createCallToolsBatchExecutor,
  finish as createFinishExecutor,
  requestHumanApprove as createRequestHumanApproveExecutor,
  resolveAbortedTools as createResolveAbortedToolsExecutor,
  resolveBlockedTools as createResolveBlockedToolsExecutor,
} from '@lobechat/agent-runtime';

import { buildHost } from './buildHost';
import type { RuntimeExecutorContext } from './context';
import { callLlm } from './executors/callLlm';
import { compressContext } from './executors/compressContext';
import { execSubAgent, execSubAgents } from './executors/execSubAgent';

export { type RuntimeExecutorContext } from './context';

export const createRuntimeExecutors = (
  ctx: RuntimeExecutorContext,
): Partial<Record<AgentInstruction['type'], InstructionExecutor>> => {
  // Package-hosted executors take an AgentRuntimeHost (transport adapters +
  // operation context) instead of the raw server ctx. Built once per operation.
  const host = buildHost(ctx);

  return {
    call_llm: callLlm(ctx),
    call_tool: createCallToolExecutor(host),
    call_tools_batch: createCallToolsBatchExecutor(host),
    compress_context: compressContext(ctx),
    exec_sub_agent: execSubAgent(ctx),
    exec_sub_agents: execSubAgents(ctx),
    // Migrated into @lobechat/agent-runtime as part of the IO transport port
    // abstraction — the server now only registers adapters via buildHost.
    finish: createFinishExecutor(host),
    request_human_approve: createRequestHumanApproveExecutor(host),
    resolve_aborted_tools: createResolveAbortedToolsExecutor(host),
    resolve_blocked_tools: createResolveBlockedToolsExecutor(host),
  };
};
