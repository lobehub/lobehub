import type {
  ChatImageItem,
  ChatToolPayload,
  GroundingSearch,
  MessageToolCall,
  ModelPerformance,
  ModelUsage,
  OpenAIChatMessage,
} from '@lobechat/types';

import type { AgentEvent, AgentState, CallLLMPayload } from '../types';
import type { ClassifiedLLMError } from '../utils';
import type { ContextBuildOutput } from './context';

export interface LLMStreamPayload {
  [key: string]: unknown;
  messages: OpenAIChatMessage[] | CallLLMPayload['messages'];
  model: string;
  provider: string;
  stream?: boolean;
  tools?: CallLLMPayload['tools'];
}

/**
 * Aggregated result for lightweight stream consumers such as context
 * compression. Full `call_llm` execution uses {@link LLMAttemptOutput}.
 */
export interface LLMStreamResult {
  [key: string]: unknown;
  content: string;
  reasoning?: string;
  usage?: ModelUsage;
}

export interface LLMStreamHandlers {
  onChunk?: (chunk: unknown) => void;
  onError?: (error: unknown) => void;
  onFinish?: (result: LLMStreamResult) => void;
  onText?: (text: string) => void;
}

export type LLMAttemptContentPart =
  { image: string; type: 'image' } | { text: string; type: 'text' };

export interface LLMAttemptOutput {
  answerSalvagedFromReasoning: boolean;
  content: string;
  contentParts: LLMAttemptContentPart[];
  finishReason?: string;
  grounding: GroundingSearch | null;
  hasContentImages: boolean;
  hasReasoningImages: boolean;
  imageList: ChatImageItem[];
  reasoningParts: LLMAttemptContentPart[];
  speed?: ModelPerformance;
  /** Raw streamed thinking text; finalization converts it to the message reasoning object. */
  thinkingContent: string;
  toolCalls: MessageToolCall[];
  toolsCalling: ChatToolPayload[];
  usage?: ModelUsage;
}

export interface LLMAttemptInput {
  attempt: number;
  context: ContextBuildOutput;
  events: AgentEvent[];
  maxAttempts: number;
  model: string;
  onFirstChunk?: () => void;
  provider: string;
  state: AgentState;
}

export type LLMAttemptExecution =
  { error: unknown; ok: false; output: LLMAttemptOutput } | { ok: true; output: LLMAttemptOutput };

export interface LLMCallErrorInput {
  error: unknown;
  events: AgentEvent[];
  interrupted: boolean;
  output?: LLMAttemptOutput;
  retryBudget?: number;
}

export interface LLMRetryInput {
  attempt: number;
  delayMs: number;
  error: ClassifiedLLMError;
  maxAttempts: number;
}

export interface LLMRetryPolicy {
  classifyError: (error: unknown) => ClassifiedLLMError;
  maxAttempts: (provider: string) => number;
  onError?: (input: LLMCallErrorInput) => Promise<void> | void;
  onRetry?: (input: LLMRetryInput) => Promise<void> | void;
  resolveRetryBudget: (provider: string, error: unknown) => number;
  waitForRetry?: (delayMs: number) => Promise<void>;
}

export interface LLMTraceInput {
  assistantMessageId: string;
  conversationId?: string;
  model: string;
  provider: string;
}

/** Narrow tracing scope shared by all attempts in one package-owned call. */
export interface LLMTrace {
  close: (error?: unknown) => Promise<void> | void;
  onFirstChunk: () => void;
  recordResult?: (output: LLMAttemptOutput) => Promise<void> | void;
  run: <T>(task: () => Promise<T>) => Promise<T>;
}

/**
 * Streams a model completion. Server adapter wraps `initModelRuntimeFromDB` +
 * `ModelRuntime.chat` + `consumeStreamUntilDone`; the client adapter wraps
 * `chatService.createAssistantMessageStream`.
 *
 * Generalizes today's primitive `Agent.modelRuntime` hook. The adapter maps the
 * runtime payload to its provider format, so the package stays free of
 * `@lobechat/model-runtime`.
 */
export interface LLMTransport {
  /** Creates an optional host tracing scope; no instruction orchestration lives behind it. */
  createTrace?: (input: LLMTraceInput) => LLMTrace;
  /** Host extensions for provider retry policy and error diagnostics. */
  retryPolicy?: LLMRetryPolicy;
  /** Executes one model attempt and returns both successful or partial output. */
  runAttempt?: (input: LLMAttemptInput) => Promise<LLMAttemptExecution>;
  stream: (
    payload: LLMStreamPayload,
    handlers?: LLMStreamHandlers,
    signal?: AbortSignal,
  ) => Promise<LLMStreamResult>;
}
