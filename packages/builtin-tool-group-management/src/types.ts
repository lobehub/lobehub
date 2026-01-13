/* eslint-disable sort-keys-fix/sort-keys-fix */

/**
 * API names for Group Management tool
 */
export const GroupManagementApiName = {
  // ==================== Member Management ====================
  /** Search for agents that can be invited to the group */
  searchAgent: 'searchAgent',
  /** Invite an agent to join the group */
  inviteAgent: 'inviteAgent',
  /** Create a new agent and add it to the group */
  createAgent: 'createAgent',
  /** Remove an agent from the group */
  removeAgent: 'removeAgent',
  /** Get detailed information about an agent */
  getAgentInfo: 'getAgentInfo',

  // ==================== Communication Coordination ====================
  /** Let a specific agent speak (synchronous, immediate response) */
  speak: 'speak',
  /** Let multiple agents speak simultaneously (parallel responses) */
  broadcast: 'broadcast',
  /** Delegate the conversation to a specific agent (supervisor exits) */
  delegate: 'delegate',

  // ==================== Task Execution ====================
  /** Let an agent execute a task asynchronously */
  executeTask: 'executeTask',
  /** Interrupt a running agent task */
  interrupt: 'interrupt',

  // ==================== Context Management ====================
  /** Summarize and compress the current conversation context */
  summarize: 'summarize',

  // ==================== Flow Control ====================
  /** Define a multi-agent collaboration workflow */
  createWorkflow: 'createWorkflow',
  /** Let multiple agents vote on a decision */
  vote: 'vote',
} as const;

export type GroupManagementApiNameType =
  (typeof GroupManagementApiName)[keyof typeof GroupManagementApiName];

// ==================== Member Management Params ====================

export interface SearchAgentParams {
  limit?: number;
  query?: string;
  source?: 'user' | 'community';
}

export interface InviteAgentParams {
  agentId: string;
}

export interface CreateAgentParams {
  avatar?: string;
  description?: string;
  systemRole: string;
  title: string;
}

export interface RemoveAgentParams {
  agentId: string;
}

export interface GetAgentInfoParams {
  agentId: string;
}

// ==================== Communication Params ====================

export interface SpeakParams {
  agentId: string;
  instruction?: string;
  /**
   * If true, the orchestration will end after this agent responds,
   * without calling the supervisor again.
   * Use this when the user explicitly requests a specific agent
   * and no further orchestration is needed.
   */
  skipCallSupervisor?: boolean;
}

export interface BroadcastParams {
  agentIds: string[];
  instruction?: string;
  /**
   * If true, the orchestration will end after agents respond,
   * without calling the supervisor again.
   * Use this when the user explicitly requests specific agents
   * and no further orchestration is needed.
   */
  skipCallSupervisor?: boolean;
}

export interface DelegateParams {
  agentId: string;
  reason?: string;
}

// ==================== Task Execution Params ====================

export interface ExecuteTaskParams {
  agentId: string;
  /**
   * If true, the orchestration will end after the task completes,
   * without calling the supervisor again.
   * Use this when the task is the final action needed.
   */
  skipCallSupervisor?: boolean;
  task: string;
  timeout?: number;
}

export interface InterruptParams {
  taskId: string;
}

// ==================== Context Management Params ====================

export interface SummarizeParams {
  focus?: string;
  preserveRecent?: number;
}

// ==================== Flow Control Params ====================

export interface WorkflowStep {
  agentId: string;
  instruction?: string;
  waitForCompletion?: boolean;
}

export interface CreateWorkflowParams {
  autoExecute?: boolean;
  name: string;
  steps: WorkflowStep[];
}

export interface VoteOption {
  description?: string;
  id: string;
  label: string;
}

export interface VoteParams {
  options: VoteOption[];
  question: string;
  requireReasoning?: boolean;
  voterAgentIds?: string[];
}

// ==================== Result Types ====================

export interface AgentSearchResult {
  avatar?: string;
  description?: string;
  id: string;
  source: 'user' | 'community';
  title: string;
}

export interface VoteResult {
  agentId: string;
  reasoning?: string;
  selectedOptionId: string;
}

// ==================== State Types for UI Rendering ====================

export type ExecuteTaskStatus =
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'interrupted';

export interface ExecuteTaskState {
  cost?: { total: number };
  error?: string;
  status: ExecuteTaskStatus;
  stepCount?: number;
  threadId: string;
  usage?: {
    completion_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

export interface InterruptState {
  cancelled: boolean;
  operationId?: string;
  taskId: string;
}
