import type { AgentRuntimeHost } from '../transport';
import type {
  AgentInstruction,
  AgentRuntimeContext,
  AgentState,
  InstructionExecutor,
} from '../types';
import { callLlm } from './callLlm';
import { compressContext } from './compressContext';
import { finish } from './finish';
import { requestHumanApprove } from './humanApprove';
import { resolveAbortedTools, resolveBlockedTools } from './resolveTools';
import { execSubAgent, execSubAgents } from './subAgent';
import { callTool, callToolsBatch } from './tool';

export type AgentRuntimeHostResolver = (
  instruction: AgentInstruction,
  state: AgentState,
  runtimeContext?: AgentRuntimeContext,
) => AgentRuntimeHost;

type ExecutorFactory = (host: AgentRuntimeHost) => InstructionExecutor;

const executorFactories = {
  call_llm: callLlm,
  call_tool: callTool,
  call_tools_batch: callToolsBatch,
  compress_context: compressContext,
  exec_sub_agent: execSubAgent,
  exec_sub_agents: execSubAgents,
  finish,
  request_human_approve: requestHumanApprove,
  resolve_aborted_tools: resolveAbortedTools,
  resolve_blocked_tools: resolveBlockedTools,
} satisfies Partial<Record<AgentInstruction['type'], ExecutorFactory>>;

/** Bind every package-owned instruction executor to a static or per-step host. */
export const createAgentRuntimeExecutors = (
  hostOrResolver: AgentRuntimeHost | AgentRuntimeHostResolver,
): Partial<Record<AgentInstruction['type'], InstructionExecutor>> => {
  const resolveHost: AgentRuntimeHostResolver =
    typeof hostOrResolver === 'function' ? hostOrResolver : () => hostOrResolver;

  return Object.fromEntries(
    Object.entries(executorFactories).map(([type, factory]) => [
      type,
      (instruction: AgentInstruction, state: AgentState, runtimeContext?: AgentRuntimeContext) =>
        factory(resolveHost(instruction, state, runtimeContext))(
          instruction,
          state,
          runtimeContext,
        ),
    ]),
  );
};
