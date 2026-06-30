import type {
  ExecSubAgentParams,
  ExecSubAgentResult,
  ExecVirtualSubAgentParams,
} from '@lobechat/types';

/**
 * Forks child agent runs for the `exec_sub_agent` / `exec_sub_agents`
 * executors. `execVirtualSubAgent` additionally installs the async completion
 * bridge and marks the child as a sub-agent.
 *
 * Group-member fan-out (`lobe-group-management`) is NOT here — it is plumbed
 * through the tool-execution adapter as the per-call member runner, so it
 * stays bound inside {@link ToolTransport}.
 */
export interface SubAgentTransport {
  execSubAgent: (params: ExecSubAgentParams) => Promise<ExecSubAgentResult>;
  execVirtualSubAgent: (params: ExecVirtualSubAgentParams) => Promise<ExecSubAgentResult>;
}
