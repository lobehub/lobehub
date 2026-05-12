import type {
  ChatToolPayload,
  ModelUsage,
  RuntimeInitialContext,
  RuntimeStepContext,
} from '@lobechat/types';

import type { FinishReason } from './event';
import type { AgentState, ToolRegistry } from './state';
import type { Cost, CostCalculationContext, Usage } from './usage';

/**
 * Runtime execution context passed to Agent runner
 */
export interface AgentRuntimeContext {
  /**
   * Initial context captured at operation start
   * Contains static state like initial page content that doesn't change during execution
   * Set once during initialization and passed through to Context Engine
   */
  initialContext?: RuntimeInitialContext;

  metadata?: Record<string, unknown>;

  /** Operation ID (links to Operation for business context) */
  operationId?: string;

  /** Phase-specific payload/context */
  payload?: unknown;

  /** Current execution phase */
  phase:
    | 'init'
    | 'user_input'
    | 'llm_result'
    | 'tool_result'
    | 'tools_batch_result'
    | 'sub_agent_result'
    | 'sub_agents_batch_result'
    | 'human_response'
    | 'human_approved_tool'
    | 'human_abort'
    | 'compression_result'
    | 'error';

  /** Session info (kept for backward compatibility, will be optional in the future) */
  session?: {
    messageCount: number;
    sessionId: string;
    status: AgentState['status'];
    stepCount: number;
  };

  /**
   * Step context computed at the beginning of each step
   * Contains dynamic state like lobe-agent todos that changes between steps
   * Computed by AgentRuntime and passed to Context Engine and Tool Executors
   */
  stepContext?: RuntimeStepContext;

  /** Usage statistics from the current step (if applicable) */
  stepUsage?: ModelUsage | unknown;
}

/**
 * Represents the "Brain" of an agent.
 * It contains all the decision-making logic and is completely stateless.
 */
export interface Agent {
  /**
   * Calculate cost from usage statistics
   * @param context - Cost calculation context with usage and limits
   * @returns Updated cost information
   */
  calculateCost?: (context: CostCalculationContext) => Cost;

  /**
   * Calculate usage statistics from operation results
   * @param operationType - Type of operation that was performed
   * @param operationResult - Result data from the operation
   * @param previousUsage - Previous usage statistics
   * @returns Updated usage statistics
   */
  calculateUsage?: (
    operationType: 'llm' | 'tool' | 'human_interaction',
    operationResult: any,
    previousUsage: Usage,
  ) => Usage;

  /** Optional custom executors mapping to extend runtime behaviors */
  executors?: Partial<Record<AgentInstruction['type'], any>>;

  /**
   * Model runtime function for LLM calls - Agent owns its model integration
   * @param payload - LLM call payload (messages, tools, etc.)
   * @returns Async iterable of streaming response chunks
   */
  modelRuntime?: (payload: unknown) => AsyncIterable<any>;

  /**
   * The core runner method. Based on the current execution context and state,
   * it decides what the next action should be.
   * @param context - Current runtime context with phase and payload
   * @param state - Complete agent state for reference
   */
  runner: (
    context: AgentRuntimeContext,
    state: AgentState,
  ) => Promise<AgentInstruction | AgentInstruction[]>;

  /** Optional tools registry held by the agent */
  tools?: ToolRegistry;
}

// ── Payloads ──────────────────────────────────────────────

export interface CallLLMPayload {
  isFirstMessage?: boolean;
  messages: any[];
  model: string;
  parentId?: string;
  provider: string;
  tools: any[];
}

export interface CallingToolPayload {
  apiName: string;
  arguments: string;
  id: string;
  identifier: string;
  type: 'mcp' | 'default' | 'markdown' | 'standalone';
}

export interface HumanAbortPayload {
  /** Whether there are pending tool calls */
  hasToolsCalling?: boolean;
  /** Parent message ID (assistant message) */
  parentMessageId: string;
  /** Reason for the abort */
  reason: string;
  /** LLM result including content and tool_calls */
  result?: {
    content: string;
    tool_calls?: any[];
  };
  /** Pending tool calls that need to be cancelled */
  toolsCalling?: ChatToolPayload[];
}

/**
 * Sub-agent definition for exec_sub_agents instruction
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
   * IMPORTANT: This MUST be set to true when the sub-agent requires:
   * - Reading/writing local files via `local-system` tool
   * - Executing shell commands
   * - Any other desktop-only local tool operations
   *
   * If not specified or false, the sub-agent runs on the server (default behavior).
   * On non-desktop platforms (web), this flag is ignored and sub-agents always
   * run on the server.
   */
  runInClient?: boolean;
  /** Timeout in milliseconds (optional, default 30 minutes) */
  timeout?: number;
}

/**
 * Payload for sub_agent_result phase (single sub-agent)
 */
export interface SubAgentResultPayload {
  /** Parent message ID */
  parentMessageId: string;
  /** Result from executed sub-agent */
  result: {
    /** Error message if sub-agent failed */
    error?: string;
    /** Sub-agent result content */
    result?: string;
    /** Whether the sub-agent completed successfully */
    success: boolean;
    /** Sub-agent message ID */
    taskMessageId: string;
    /** Thread ID where the sub-agent was executed */
    threadId: string;
  };
}

/**
 * Payload for sub_agents_batch_result phase (multiple sub-agents)
 */
export interface SubAgentsBatchResultPayload {
  /** Parent message ID */
  parentMessageId: string;
  /** Results from executed sub-agents */
  results: Array<{
    /** Error message if sub-agent failed */
    error?: string;
    /** Sub-agent result content */
    result?: string;
    /** Whether the sub-agent completed successfully */
    success: boolean;
    /** Sub-agent message ID */
    taskMessageId: string;
    /** Thread ID where the sub-agent was executed */
    threadId: string;
  }>;
}

// ── Instructions ──────────────────────────────────────────

/**
 * Common fields shared across all instruction types.
 * Agents can set `stepLabel` to label the current step for display in streaming events and hooks.
 */
export interface AgentInstructionBase {
  /** Human-readable label for this step (e.g. graph node name). Propagated to stream events and hooks. */
  stepLabel?: string;
}

// ─ LLM ───────────────────────────────────────────────────

export interface AgentInstructionCallLlm extends AgentInstructionBase {
  payload: any;
  type: 'call_llm';
}

// ─ Tool ──────────────────────────────────────────────────

export interface AgentInstructionCallTool extends AgentInstructionBase {
  payload: {
    parentMessageId: string;
    /**
     * When true, the runtime is resuming execution for a previously pending
     * tool call (e.g. after human approval). The executor must NOT insert a
     * new tool message; instead it updates the existing one referenced by
     * `parentMessageId` with the tool result.
     */
    skipCreateToolMessage?: boolean;
    toolCalling: ChatToolPayload;
  };
  type: 'call_tool';
}

export interface AgentInstructionCallToolsBatch extends AgentInstructionBase {
  payload: {
    parentMessageId: string;
    toolsCalling: ChatToolPayload[];
  } & any;
  type: 'call_tools_batch';
}

export interface AgentInstructionResolveAbortedTools extends AgentInstructionBase {
  payload: {
    /** Parent message ID (assistant message) */
    parentMessageId: string;
    /** Reason for the abort */
    reason?: string;
    /** Tool calls that need to be resolved/cancelled */
    toolsCalling: ChatToolPayload[];
  };
  type: 'resolve_aborted_tools';
}

// ─ Sub-Agent ─────────────────────────────────────────────

export interface AgentInstructionExecSubAgent extends AgentInstructionBase {
  payload: {
    /** Parent message ID (tool message that dispatched the sub-agent) */
    parentMessageId: string;
    /** Sub-agent to execute */
    task: SubAgentTask;
  };
  type: 'exec_sub_agent';
}

export interface AgentInstructionExecSubAgents extends AgentInstructionBase {
  payload: {
    /** Parent message ID (tool message that dispatched the sub-agents) */
    parentMessageId: string;
    /** Array of sub-agents to execute */
    tasks: SubAgentTask[];
  };
  type: 'exec_sub_agents';
}

export interface AgentInstructionExecClientSubAgent extends AgentInstructionBase {
  payload: {
    /** Parent message ID (tool message that dispatched the sub-agent) */
    parentMessageId: string;
    /** Sub-agent to execute */
    task: SubAgentTask;
  };
  type: 'exec_client_sub_agent';
}

export interface AgentInstructionExecClientSubAgents extends AgentInstructionBase {
  payload: {
    /** Parent message ID (tool message that dispatched the sub-agents) */
    parentMessageId: string;
    /** Array of sub-agents to execute */
    tasks: SubAgentTask[];
  };
  type: 'exec_client_sub_agents';
}

// ─ Human Interaction ─────────────────────────────────────

export interface AgentInstructionRequestHumanPrompt extends AgentInstructionBase {
  metadata?: Record<string, unknown>;
  prompt: string;
  reason?: string;
  type: 'request_human_prompt';
}

export interface AgentInstructionRequestHumanSelect extends AgentInstructionBase {
  metadata?: Record<string, unknown>;
  multi?: boolean;
  options: Array<{ label: string; value: string }>;
  prompt?: string;
  reason?: string;
  type: 'request_human_select';
}

export interface AgentInstructionRequestHumanApprove extends AgentInstructionBase {
  pendingToolsCalling: ChatToolPayload[];
  reason?: string;
  skipCreateToolMessage?: boolean;
  type: 'request_human_approve';
}

// ─ Control ───────────────────────────────────────────────

export interface AgentInstructionCompressContext extends AgentInstructionBase {
  payload: {
    /** Current token count before compression */
    currentTokenCount: number;
    /** Existing summary to incorporate (for incremental compression) */
    existingSummary?: string;
    /** Messages to compress */
    messages: any[];
  };
  type: 'compress_context';
}

export interface AgentInstructionFinish extends AgentInstructionBase {
  reason: FinishReason;
  reasonDetail?: string;
  type: 'finish';
}

// ── Union Type ────────────────────────────────────────────

/**
 * A serializable instruction object that the "Agent" (Brain) returns
 * to the "AgentRuntime" (Engine) to execute.
 */
export type AgentInstruction =
  // LLM
  | AgentInstructionCallLlm
  // Tool
  | AgentInstructionCallTool
  | AgentInstructionCallToolsBatch
  | AgentInstructionResolveAbortedTools
  // Sub-Agent
  | AgentInstructionExecSubAgent
  | AgentInstructionExecSubAgents
  | AgentInstructionExecClientSubAgent
  | AgentInstructionExecClientSubAgents
  // Human Interaction
  | AgentInstructionRequestHumanPrompt
  | AgentInstructionRequestHumanSelect
  | AgentInstructionRequestHumanApprove
  // Control
  | AgentInstructionCompressContext
  | AgentInstructionFinish;
