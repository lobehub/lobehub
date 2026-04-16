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
    | 'task_result'
    | 'tasks_batch_result'
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
   * Contains dynamic state like GTD todos that changes between steps
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
 * Task definition for exec_tasks instruction
 */
export interface ExecTaskItem {
  /** Brief description of what this task does (shown in UI) */
  description: string;
  /** Whether to inherit context messages from parent conversation */
  inheritMessages?: boolean;
  /** Detailed instruction/prompt for the task execution */
  instruction: string;
  /**
   * Whether to execute the task on the client side (desktop only).
   * When true and running on desktop, the task will be executed locally
   * with access to local tools (file system, shell commands, etc.).
   *
   * IMPORTANT: This MUST be set to true when the task requires:
   * - Reading/writing local files via `local-system` tool
   * - Executing shell commands
   * - Any other desktop-only local tool operations
   *
   * If not specified or false, the task runs on the server (default behavior).
   * On non-desktop platforms (web), this flag is ignored and tasks always run on server.
   */
  runInClient?: boolean;
  /** Timeout in milliseconds (optional, default 30 minutes) */
  timeout?: number;
}

/**
 * Payload for task_result phase (single task)
 */
export interface TaskResultPayload {
  /** Parent message ID */
  parentMessageId: string;
  /** Result from executed task */
  result: {
    /** Error message if task failed */
    error?: string;
    /** Task result content */
    result?: string;
    /** Whether the task completed successfully */
    success: boolean;
    /** Task message ID */
    taskMessageId: string;
    /** Thread ID where the task was executed */
    threadId: string;
  };
}

/**
 * Payload for tasks_batch_result phase (multiple tasks)
 */
export interface TasksBatchResultPayload {
  /** Parent message ID */
  parentMessageId: string;
  /** Results from executed tasks */
  results: Array<{
    /** Error message if task failed */
    error?: string;
    /** Task result content */
    result?: string;
    /** Whether the task completed successfully */
    success: boolean;
    /** Task message ID */
    taskMessageId: string;
    /** Thread ID where the task was executed */
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

// ─ Task ──────────────────────────────────────────────────

export interface AgentInstructionExecTask extends AgentInstructionBase {
  payload: {
    /** Parent message ID (tool message that triggered the task) */
    parentMessageId: string;
    /** Task to execute */
    task: ExecTaskItem;
  };
  type: 'exec_task';
}

export interface AgentInstructionExecTasks extends AgentInstructionBase {
  payload: {
    /** Parent message ID (tool message that triggered the tasks) */
    parentMessageId: string;
    /** Array of tasks to execute */
    tasks: ExecTaskItem[];
  };
  type: 'exec_tasks';
}

export interface AgentInstructionExecClientTask extends AgentInstructionBase {
  payload: {
    /** Parent message ID (tool message that triggered the task) */
    parentMessageId: string;
    /** Task to execute */
    task: ExecTaskItem;
  };
  type: 'exec_client_task';
}

export interface AgentInstructionExecClientTasks extends AgentInstructionBase {
  payload: {
    /** Parent message ID (tool message that triggered the tasks) */
    parentMessageId: string;
    /** Array of tasks to execute */
    tasks: ExecTaskItem[];
  };
  type: 'exec_client_tasks';
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
  // Task
  | AgentInstructionExecTask
  | AgentInstructionExecTasks
  | AgentInstructionExecClientTask
  | AgentInstructionExecClientTasks
  // Human Interaction
  | AgentInstructionRequestHumanPrompt
  | AgentInstructionRequestHumanSelect
  | AgentInstructionRequestHumanApprove
  // Control
  | AgentInstructionCompressContext
  | AgentInstructionFinish;
