import type {
  ChatImageItem,
  ChatToolPayload,
  GroundingSearch,
  MessageToolCall,
  ModelPerformance,
  ModelUsage,
  OpenAIChatMessage,
} from '@lobechat/types';

import type { AgentEvent, AgentState, CallLLMPayload, InstructionExecutionResult } from '../types';
import type { ContextBuildOutput } from './context';
import type { RuntimeMessageRef } from './message';

export interface LLMStreamPayload {
  [key: string]: unknown;
  messages: OpenAIChatMessage[] | CallLLMPayload['messages'];
  model: string;
  provider: string;
  stream?: boolean;
  tools?: CallLLMPayload['tools'];
}

/**
 * Aggregated result of one model turn.
 *
 * NOTE (scaffolding): only the always-present fields are pinned. usage / cost /
 * toolCalls / images / finishReason firm when `call_llm` (Tier C) migrates onto
 * the port — that migration is what actually dissolves the 1700-line executor.
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
  reasoning: string;
  reasoningParts: LLMAttemptContentPart[];
  speed?: ModelPerformance;
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

export interface LLMTurnInput {
  assistantMessage: RuntimeMessageRef;
  context: ContextBuildOutput;
  model: string;
  provider: string;
  state: AgentState;
  stepLabel?: string;
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
  /**
   * Executes one prepared model turn. The package executor owns instruction
   * setup/context while the adapter owns retry and persistence until those
   * phases move onto narrower transport ports.
   */
  executeTurn?: (input: LLMTurnInput) => Promise<InstructionExecutionResult>;
  /** Executes one model attempt and returns both successful or partial output. */
  runAttempt?: (input: LLMAttemptInput) => Promise<LLMAttemptExecution>;
  stream: (
    payload: LLMStreamPayload,
    handlers?: LLMStreamHandlers,
    signal?: AbortSignal,
  ) => Promise<LLMStreamResult>;
}
