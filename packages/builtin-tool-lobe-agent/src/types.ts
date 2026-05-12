export const LobeAgentIdentifier = 'lobe-agent';

export const LobeAgentApiName = {
  analyzeVisualMedia: 'analyzeVisualMedia',
  callSubAgent: 'callSubAgent',
  callSubAgents: 'callSubAgents',
} as const;

export type LobeAgentApiNameType = (typeof LobeAgentApiName)[keyof typeof LobeAgentApiName];

export interface AnalyzeVisualMediaParams {
  question: string;
  refs?: string[];
  urls?: string[];
}

// ==================== Sub-Agent Tasks ====================

/**
 * Single sub-agent task definition.
 *
 * A sub-agent is a long-running, isolated execution that runs in its own
 * context (server or desktop client) and reports back to the parent
 * conversation when it finishes.
 */
export interface SubAgentTask {
  /** Brief description of what this sub-agent does (shown in UI) */
  description: string;
  /** Whether to inherit context messages from parent conversation */
  inheritMessages?: boolean;
  /** Detailed instruction/prompt for the sub-agent execution */
  instruction: string;
  /**
   * Whether to execute the sub-agent on the client side (desktop only).
   * When true and running on desktop, the sub-agent runs locally with
   * access to local tools (file system, shell commands, etc.).
   *
   * MUST be true when the sub-agent requires local-system tools.
   */
  runInClient?: boolean;
  /** Timeout in milliseconds (optional, default 30 minutes) */
  timeout?: number;
}

/**
 * Parameters for callSubAgent API
 * Dispatch a single sub-agent.
 */
export interface CallSubAgentParams {
  description: string;
  inheritMessages?: boolean;
  instruction: string;
  runInClient?: boolean;
  timeout?: number;
}

/**
 * Parameters for callSubAgents API
 * Dispatch one or more sub-agents in parallel.
 */
export interface CallSubAgentsParams {
  tasks: SubAgentTask[];
}

/**
 * State returned after dispatching a server-side sub-agent.
 *
 * The `type` value is the wire-level discriminator the `agent-runtime`
 * layer (`GeneralChatAgent.tool_result`) inspects to emit the matching
 * `exec_sub_agent` / `exec_client_sub_agent` instruction.
 */
export interface CallSubAgentState {
  parentMessageId: string;
  task: SubAgentTask;
  type: 'execSubAgent';
}

/** State returned after dispatching multiple server-side sub-agents. */
export interface CallSubAgentsState {
  parentMessageId: string;
  tasks: SubAgentTask[];
  type: 'execSubAgents';
}

/** State returned after dispatching a desktop-only client-side sub-agent. */
export interface CallClientSubAgentState {
  parentMessageId: string;
  task: SubAgentTask;
  type: 'execClientSubAgent';
}

/** State returned after dispatching multiple desktop-only client-side sub-agents. */
export interface CallClientSubAgentsState {
  parentMessageId: string;
  tasks: SubAgentTask[];
  type: 'execClientSubAgents';
}
