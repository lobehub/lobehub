import type { ModelUsage, OpenAIChatMessage } from '@lobechat/types';

import type {
  AgentInstructionCallLlm,
  AgentState,
  CallLLMPayload,
  InstructionExecutor,
} from '../types';
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

export interface LLMCallExecuteInput {
  assistantMessage: RuntimeMessageRef;
  instruction: AgentInstructionCallLlm;
  model: string;
  parentId?: string;
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
   * Executes a full agent `call_llm` instruction. This is a transitional port:
   * the server adapter can keep provider/context/persistence specifics while
   * the package owns the executor registration point. The internals are split
   * into smaller context/stream/persist ports in the next migration slices.
   */
  executeCall?: (input: LLMCallExecuteInput) => ReturnType<InstructionExecutor>;
  stream: (
    payload: LLMStreamPayload,
    handlers?: LLMStreamHandlers,
    signal?: AbortSignal,
  ) => Promise<LLMStreamResult>;
}
