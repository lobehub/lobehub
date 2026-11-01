import type {
  ExecSubAgentParams,
  ExecSubAgentResult,
  ExecVirtualSubAgentParams,
} from '@lobechat/types';

export type SubAgentExecutionStatus = 'cancelled' | 'completed' | 'failed' | 'timed_out';

/**
 * Server transports normally return after dispatch, while client transports
 * can wait for the child task to reach a terminal state. Optional terminal
 * fields let the shared executor support both modes without importing client
 * polling concerns into the package.
 */
export interface SubAgentExecutionResult extends ExecSubAgentResult {
  result?: string;
  status?: SubAgentExecutionStatus;
}

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
  execSubAgent: (params: ExecSubAgentParams) => Promise<SubAgentExecutionResult>;
  execVirtualSubAgent: (params: ExecVirtualSubAgentParams) => Promise<SubAgentExecutionResult>;
}
