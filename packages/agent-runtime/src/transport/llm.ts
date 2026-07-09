import type { ModelUsage, OpenAIChatMessage } from '@lobechat/types';

import type { CallLLMPayload } from '../types';

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
  stream: (
    payload: LLMStreamPayload,
    handlers?: LLMStreamHandlers,
    signal?: AbortSignal,
  ) => Promise<LLMStreamResult>;
}
