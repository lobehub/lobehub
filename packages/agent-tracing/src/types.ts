export interface ExecutionSnapshot {
  agentId?: string;
  completedAt?: number;
  completionReason?:
    | 'done'
    | 'error'
    | 'interrupted'
    | 'max_steps'
    | 'cost_limit'
    | 'waiting_for_human';
  error?: { type: string; message: string };
  model?: string;
  operationId: string;
  provider?: string;
  startedAt: number;
  steps: StepSnapshot[];
  topicId?: string;
  totalCost: number;
  totalSteps: number;
  totalTokens: number;
  traceId: string;
  userId?: string;
}

export interface StepSnapshot {
  /**
   * Tools newly activated during this step via tool discovery.
   * Append-only delta — accumulate across steps to reconstruct full `activatedStepTools`.
   */
  activatedStepToolsDelta?: any[];
  completedAt: number;
  // LLM data
  content?: string;
  context?: {
    phase: string;
    payload?: unknown;
    stepContext?: unknown;
  };
  events?: Array<{ type: string; [key: string]: unknown }>;

  executionTimeMs: number;

  inputTokens?: number;

  /**
   * Whether this step triggered context compression.
   * When true, `messagesBaseline` contains the compressed messages as a new baseline.
   */
  isCompressionReset?: boolean;
  /**
   * @deprecated Use `messagesBaseline` + `messagesDelta` for incremental format.
   * Kept for backward compatibility with old snapshots.
   */
  messages?: any[];

  /**
   * @deprecated Use `messagesBaseline` + `messagesDelta` for incremental format.
   * Kept for backward compatibility with old snapshots.
   */
  messagesAfter?: any[];

  /**
   * Full messages baseline snapshot. Only present when:
   * 1. `stepIndex === 0` (initial baseline)
   * 2. Context compression occurred (`isCompressionReset === true`)
   */
  messagesBaseline?: any[];

  /**
   * Incremental messages added by this step relative to the previous step's state.
   * For `call_llm`: typically `[assistant message]`
   * For `call_tool`: typically `[tool_result message(s)]`
   */
  messagesDelta?: any[];

  outputTokens?: number;

  reasoning?: string;
  startedAt: number;

  stepIndex: number;
  stepType: 'call_llm' | 'call_tool';

  // Tool data
  toolsCalling?: Array<{
    apiName: string;
    identifier: string;
    arguments?: string;
  }>;
  /**
   * Operation-level tool set baseline. Only present at `stepIndex === 0`.
   * Immutable after operation creation — stored once to avoid per-step duplication.
   */
  toolsetBaseline?: any;
  toolsResult?: Array<{
    apiName: string;
    identifier: string;
    isSuccess?: boolean;
    output?: string;
  }>;
  totalCost: number;

  // Cumulative
  totalTokens: number;
}

export interface SnapshotSummary {
  completionReason?: string;
  createdAt: number;
  durationMs: number;
  hasError: boolean;
  model?: string;
  operationId: string;
  totalSteps: number;
  totalTokens: number;
  traceId: string;
}
