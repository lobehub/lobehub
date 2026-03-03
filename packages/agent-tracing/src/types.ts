export interface ExecutionSnapshot {
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
  totalCost: number;
  totalSteps: number;
  totalTokens: number;
  traceId: string;
}

export interface StepSnapshot {
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
  // Detailed data (for inspect --step N)
  messages?: any[];
  messagesAfter?: any[];
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
