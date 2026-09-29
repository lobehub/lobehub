import type {
  ChatErrorBudgetContext,
  ChatErrorHeterogeneousContext,
  ExecutionPlan,
  ToolExecutor,
} from '@lobechat/types';

import type { ToolRunResult } from '../transport/tool';

/**
 * Agent Runtime Hook Types
 *
 * Pure data types for hook lifecycle events.
 * The hook registration/dispatch mechanism (AgentHook, webhook delivery,
 * serialization) lives in the server layer.
 */

/**
 * Lifecycle hook points in agent execution
 */
export type AgentHookType =
  | 'afterStep' // After each step completes
  | 'afterToolCall' // After a tool call completes (observation only)
  | 'beforeStep' // Before each step executes
  | 'beforeToolCall' // Before a tool call executes (supports mocking via event.mock())
  | 'beforeCallAgent' // Before calling a sub-agent
  | 'afterCallAgent' // After sub-agent creation/start returns, not when the child completes
  | 'beforeCompact' // Before context compression starts
  | 'beforeHumanIntervention' // Before agent pauses for human approval
  | 'afterCompact' // After context compression completes
  | 'afterHumanIntervention' // After human approves/rejects and agent resumes
  | 'onCallAgentError' // Sub-agent execution failed
  | 'onCompactError' // Context compression failed
  | 'onComplete' // Operation reaches terminal state (done/error/interrupted)
  | 'onStopByHumanIntervention' // Human rejected and agent halted
  | 'onError' // Error during execution
  | 'onToolCallError'; // Tool call threw an exception (not just success=false)

/**
 * Unified event payload passed to hook handlers and webhook payloads
 */
/**
 * Outbound attachment carried alongside the agent's final reply text.
 * Populated only on `onComplete`. JSON-safe so it survives webhook delivery.
 */
export interface HookEventAttachment {
  /** Base64-encoded bytes. Used when no fetchable URL exists. */
  data?: string;
  /** Remote URL the downstream consumer can GET to retrieve the bytes. */
  fetchUrl?: string;
  mimeType?: string;
  name?: string;
  type: 'image' | 'file' | 'video' | 'audio';
}

export interface AgentHookEvent {
  // Identification
  agentId: string;
  /**
   * Outbound attachments extracted from the final assistant message's
   * multimodal `content` parts (or tool messages that produced image/file
   * outputs). Set on `onComplete` events; downstream consumers (bot reply
   * callbacks) forward these to platform messengers.
   */
  attachments?: HookEventAttachment[];
  /** LLM text output (afterStep only) */
  content?: string;
  // Statistics
  cost?: number;
  duration?: number;
  /** Elapsed time since operation started in ms (afterStep only) */
  elapsedMs?: number;
  /**
   * Error ownership from the model-runtime error taxonomy (`who should fix it`):
   * `user` | `provider` | `harness` | `system`. Lets consumers pick a
   * user-facing message tier (and decide whether to keep the Operation ID
   * prominent) without re-deriving the error spec themselves.
   */
  errorAttribution?: string;
  /**
   * Structured allowance context when the run was rejected for want of
   * spendable credits — which allowance ran out, how much it had left, and how
   * much this request needed. Lets a consumer name the exhausted allowance
   * instead of rendering one generic "not enough credits" line for every
   * scope. Consumers decide what is safe to show: the figures describe the
   * billed allowance, which is not necessarily the recipient's own.
   */
  errorBudget?: ChatErrorBudgetContext;
  // Content
  errorDetail?: string;
  errorHeterogeneous?: ChatErrorHeterogeneousContext;

  errorMessage?: string;

  /**
   * Stable error code (e.g. `NoAvailableProvider`, `InvalidProviderAPIKey`).
   * Populated when the underlying error carries an `errorType` from
   * `AgentRuntimeError.chat`. Hooks should switch on this code rather than
   * pattern-matching `errorMessage`, which is free-form text.
   */
  errorType?: string;

  /** Step execution time in ms (afterStep only) */
  executionTimeMs?: number;
  /**
   * Full AgentState — only available in local mode.
   * Not serialized to webhook payloads.
   * Use for consumers that need deep state access (e.g., SubAgent Thread updates).
   */
  finalState?: any;

  lastAssistantContent?: string;
  /** Last LLM content from previous steps — for showing context during tool execution (afterStep only) */
  lastLLMContent?: string;
  /** Last tools calling from previous steps (afterStep only) */
  lastToolsCalling?: any;
  llmCalls?: number;

  // Caller-provided metadata (from webhook.body)
  metadata?: Record<string, unknown>;
  operationId: string;
  // Execution result
  reason?: string; // 'done' | 'error' | 'interrupted' | 'max_steps' | 'cost_limit'
  /** LLM reasoning / thinking content (afterStep only) */
  reasoning?: string;
  // Step-specific (for beforeStep/afterStep)
  shouldContinue?: boolean;
  status?: string; // 'done' | 'error' | 'interrupted' | 'waiting_for_human'
  /** Step cost (afterStep only, LLM steps) */
  stepCost?: number;
  stepIndex?: number;

  /** Step label for display (e.g. graph node name when using GraphAgent) */
  stepLabel?: string;
  steps?: number;
  stepType?: string; // 'call_llm' | 'call_tool'
  /** Whether next step is LLM thinking (afterStep only) */
  thinking?: boolean;

  toolCalls?: number;
  /** Tools the LLM decided to call (afterStep only) */
  toolsCalling?: any;
  /** Results from tool execution (afterStep only) */
  toolsResult?: any;
  topicId?: string;
  /** Cumulative total cost (afterStep only) */
  totalCost?: number;
  /** Cumulative input tokens (afterStep only) */
  totalInputTokens?: number;
  /** Cumulative output tokens (afterStep only) */
  totalOutputTokens?: number;
  /** Total steps executed so far (afterStep only) */
  totalSteps?: number;
  totalTokens?: number;
  /** Running total of tool calls across all steps (afterStep only) */
  totalToolCalls?: number;

  userId: string;
}

/**
 * Correlation and routing facts shared by tool lifecycle notifications.
 * The server transport supplies the native toolCallId on every invocation.
 */
export interface ToolCallHookContext {
  /** Device selected by the run's execution plan and access policy, if any. */
  activeDeviceId?: string;
  agentId?: string;
  apiName: string;
  /** Effective arguments used for this invocation. */
  args: Record<string, any>;
  /** Assistant message owning the call, distinct from the source user message. */
  assistantMessageId: string;
  callIndex: number;
  documentId?: string;
  /** Effective run execution target, when the run has an execution plan. */
  executionTarget?: ExecutionPlan['target'];
  /** Transport dispatch destination; independent of the tool's origin. */
  executor: ToolExecutor;
  groupId?: string;
  identifier: string;
  operationId: string;
  /** Only present when the run has an actual parent operation in its lineage. */
  parentOperationId?: string;
  sessionId?: string;
  sourceMessageId?: string;
  stepIndex: number;
  taskId?: string;
  threadId?: string;
  /** Native model/runtime call id, never synthesized from callIndex. */
  toolCallId: string;
  /** Existing tool message on resume; absent before a new message is created. */
  toolMessageId?: string;
  toolSource?: string;
  topicId?: string;
  userId?: string;
  workspaceId?: string;
}

/**
 * Event payload for beforeToolCall hooks.
 * Call `mock()` to skip real tool execution and return a fake result.
 */
export interface ToolCallHookEvent extends ToolCallHookContext {
  /** Returns false when an earlier hook already won the mock slot. */
  mock: (result: ToolRunResult) => boolean;
}

/** beforeToolCall notification payload, without the local mock callback. */
export type BeforeToolCallObservationEvent = ToolCallHookContext;

export interface AfterToolCallHookEvent extends ToolCallHookContext {
  /** Legacy text projection of result.content. */
  content: string;
  executionTimeMs: number;
  mocked: boolean;
  /** Structured result after archival, including errors and state (e.g. blocked). */
  result: ToolRunResult;
  success: boolean;
}

export interface ToolCallErrorHookEvent extends ToolCallHookContext {
  error: string;
}

export interface BeforeCompactHookEvent {
  messageCount: number;
  operationId: string;
  stepIndex: number;
  tokenCount: number;
  userId?: string;
}

export interface AfterCompactHookEvent {
  groupId: string;
  messagesAfter: number;
  messagesBefore: number;
  operationId: string;
  stepIndex: number;
  summary: string;
  userId?: string;
}

export interface CompactErrorHookEvent {
  error: string;
  operationId: string;
  stepIndex: number;
  tokenCount: number;
  userId?: string;
}

/** Run identity shared with tool notifications; never infer lineage from a resume. */
export type HumanInterventionHookContext = Pick<
  ToolCallHookContext,
  | 'agentId'
  | 'documentId'
  | 'groupId'
  | 'operationId'
  | 'parentOperationId'
  | 'sessionId'
  | 'sourceMessageId'
  | 'taskId'
  | 'threadId'
  | 'topicId'
  | 'userId'
  | 'workspaceId'
> & { assistantMessageId?: string };

export interface HumanInterventionPendingTool {
  apiName: string;
  /** Effective parsed arguments from the same payload used by the approval card. */
  args?: Record<string, unknown>;
  /** Exact approval-card arguments, also retained when they cannot be parsed. */
  arguments?: string;
  identifier: string;
  /** Native call id; optional for compatibility with existing producers. */
  toolCallId?: string;
}

export interface BeforeHumanInterventionHookEvent extends HumanInterventionHookContext {
  pendingTools: HumanInterventionPendingTool[];
  stepIndex: number;
}

export interface AfterHumanInterventionHookEvent extends HumanInterventionHookContext {
  action: 'approve' | 'reject' | 'rejectAndContinue';
  rejectionReason?: string;
  toolCallId?: string;
  /** All native calls resolved by this action, not unresolved batch siblings. */
  toolCallIds?: string[];
}

export interface StopByHumanInterventionHookEvent extends HumanInterventionHookContext {
  /** Existing runtime stop reason, distinct from the user's rejection text. */
  reason?: string;
  rejectionReason?: string;
  toolCallId?: string;
  /** All pending native calls affected by stopping the operation. */
  toolCallIds?: string[];
}

export interface BeforeCallAgentHookEvent {
  agentId: string;
  instruction: string;
  operationId: string;
  userId?: string;
}

/** Reports the creation/start result; child completion belongs to its onComplete hook. */
export interface AfterCallAgentHookEvent {
  agentId: string;
  operationId: string;
  subOperationId: string;
  success: boolean;
  /** Isolated child thread, when available; shared group members have no isolated thread. */
  threadId?: string;
  userId?: string;
}

export interface CallAgentErrorHookEvent {
  agentId: string;
  error: string;
  operationId: string;
  userId?: string;
}

/**
 * Union of all hook event types for dispatch methods that accept any hook event.
 */
export type AnyHookEvent =
  | AfterCallAgentHookEvent
  | AfterCompactHookEvent
  | AfterHumanInterventionHookEvent
  | AfterToolCallHookEvent
  | AgentHookEvent
  | BeforeCallAgentHookEvent
  | BeforeCompactHookEvent
  | BeforeHumanInterventionHookEvent
  | BeforeToolCallObservationEvent
  | CallAgentErrorHookEvent
  | CompactErrorHookEvent
  | StopByHumanInterventionHookEvent
  | ToolCallErrorHookEvent;
