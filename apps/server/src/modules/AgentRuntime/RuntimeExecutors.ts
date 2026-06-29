import { type AgentInstruction, type InstructionExecutor } from '@lobechat/agent-runtime';

import { type RuntimeExecutorContext } from './context';
import { callLlm } from './executors/callLlm';
import { callTool } from './executors/callTool';
import { callToolsBatch } from './executors/callToolsBatch';
import { compressContext } from './executors/compressContext';
import { execSubAgent, execSubAgents } from './executors/execSubAgent';
import { finish } from './executors/finish';
import { requestHumanApprove } from './executors/humanApprove';
import { resolveAbortedTools, resolveBlockedTools } from './executors/resolveTools';

export { type RuntimeExecutorContext } from './context';

/**
 * Assemble the per-instruction executors for one agent-runtime operation.
 *
 * Each executor is a self-contained module under `./executors/*`; this factory
 * only wires them to the shared {@link RuntimeExecutorContext}. The executors
 * close over nothing but `ctx`, so the wiring here is pure composition — see the
 * individual files for the actual logic.
 */
export const createRuntimeExecutors = (
  ctx: RuntimeExecutorContext,
): Partial<Record<AgentInstruction['type'], InstructionExecutor>> => ({
  call_llm: callLlm(ctx),
  call_tool: callTool(ctx),
  call_tools_batch: callToolsBatch(ctx),
  compress_context: compressContext(ctx),
  exec_sub_agent: execSubAgent(ctx),
  exec_sub_agents: execSubAgents(ctx),
  finish: finish(ctx),
  request_human_approve: requestHumanApprove(ctx),
  resolve_aborted_tools: resolveAbortedTools(ctx),
  resolve_blocked_tools: resolveBlockedTools(ctx),
});
