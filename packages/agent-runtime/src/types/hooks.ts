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
  | 'afterCallAgent' // After sub-agent completes
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
export interface AgentHookEvent {
  // Identification
  agentId: string;
  /** LLM text output (afterStep only) */
  content?: string;
  // Statistics
  cost?: number;
  duration?: number;
  /** Elapsed time since operation started in ms (afterStep only) */
  elapsedMs?: number;
  // Content
  errorDetail?: string;

  errorMessage?: string;

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
 * Event payload for beforeToolCall hooks.
 * Call `mock()` to skip real tool execution and return a fake result.
 */
export interface ToolCallHookEvent {
  apiName: string;
  args: Record<string, any>;
  callIndex: number;
  identifier: string;
  mock: (result: { content: string }) => void;
  operationId: string;
  stepIndex: number;
}

/**
 * Event payload for beforeToolCall observation dispatch (webhook/logging).
 * Same fields as ToolCallHookEvent but without mock() — used for production webhook delivery.
 */
export interface BeforeToolCallObservationEvent {
  apiName: string;
  args: Record<string, any>;
  callIndex: number;
  identifier: string;
  operationId: string;
  stepIndex: number;
  userId?: string;
}

export interface AfterToolCallHookEvent {
  apiName: string;
  args: Record<string, any>;
  callIndex: number;
  content: string;
  executionTimeMs: number;
  identifier: string;
  mocked: boolean;
  operationId: string;
  stepIndex: number;
  success: boolean;
  userId?: string;
}

export interface ToolCallErrorHookEvent {
  apiName: string;
  args: Record<string, any>;
  callIndex: number;
  error: string;
  identifier: string;
  operationId: string;
  stepIndex: number;
  userId?: string;
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

export interface BeforeHumanInterventionHookEvent {
  operationId: string;
  pendingTools: Array<{ apiName: string; identifier: string }>;
  stepIndex: number;
  userId?: string;
}

export interface AfterHumanInterventionHookEvent {
  action: 'approve' | 'reject' | 'rejectAndContinue';
  operationId: string;
  rejectionReason?: string;
  toolCallId?: string;
  userId?: string;
}

export interface StopByHumanInterventionHookEvent {
  operationId: string;
  rejectionReason?: string;
  toolCallId?: string;
  userId?: string;
}

export interface BeforeCallAgentHookEvent {
  agentId: string;
  instruction: string;
  operationId: string;
  userId?: string;
}

export interface AfterCallAgentHookEvent {
  agentId: string;
  operationId: string;
  subOperationId: string;
  success: boolean;
  threadId: string;
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
