import { type AiFullModelCard } from 'model-bank';
import { estimateTokenCount } from 'tokenx';

import type { ChatStreamPayload } from '../types/chat';

/**
 * Default safety buffer (in tokens) reserved on top of the estimated input
 * to absorb estimator inaccuracy and per-message protocol overhead.
 */
export const DEFAULT_MAX_TOKENS_BUFFER = 1024;

/**
 * Default minimum allowed `max_tokens`. If the dynamically-derived value
 * falls below this, we treat the request as already exceeding the context
 * window and abort early instead of letting the upstream API reject it.
 */
export const DEFAULT_MIN_OUTPUT_TOKENS = 1024;

export const CONTEXT_EXCEEDED_PRE_FLIGHT_TYPE = 'context_exceeded_pre_flight' as const;

export const DEFAULT_PRE_FLIGHT_SUGGESTIONS = ['fork_topic', 'switch_to_larger_ctx_model'] as const;

export type PreFlightSuggestion = (typeof DEFAULT_PRE_FLIGHT_SUGGESTIONS)[number];

export interface ResolveSafeMaxTokensOptions {
  /** Safety buffer reserved on top of estimated input tokens. */
  bufferTokens?: number;
  /** Minimum acceptable `max_tokens`; below this we throw. */
  minOutputTokens?: number;
}

/**
 * Thrown when the estimated prompt tokens leave less room than
 * `minOutputTokens` for completion (or already exceed the model's context
 * window). Caught by `openaiCompatibleFactory` and surfaced as an
 * `ExceededContextWindow` chat error carrying structured diagnostic fields
 * — see LOBE-8974 for the rationale of failing fast instead of issuing a
 * doomed upstream request.
 */
export class ContextExceededPreFlightError extends Error {
  readonly type = CONTEXT_EXCEEDED_PRE_FLIGHT_TYPE;
  readonly model: string;
  readonly promptTokens: number;
  readonly ctx: number;
  readonly shortBy: number;
  readonly minOutputTokens: number;
  readonly suggestions: readonly PreFlightSuggestion[];

  constructor(params: {
    ctx: number;
    minOutputTokens: number;
    model: string;
    promptTokens: number;
    suggestions?: readonly PreFlightSuggestion[];
  }) {
    const { model, ctx, promptTokens, minOutputTokens, suggestions } = params;
    const shortBy = promptTokens - ctx;
    super(
      `Prompt tokens (${promptTokens}) leave less than ${minOutputTokens} tokens for completion within the model context window (${ctx}) for model "${model}". Reduce input or attached tools, or pick a model with a larger context window.`,
    );
    this.name = 'ContextExceededPreFlightError';
    this.model = model;
    this.promptTokens = promptTokens;
    this.ctx = ctx;
    this.shortBy = shortBy;
    this.minOutputTokens = minOutputTokens;
    this.suggestions = suggestions ?? DEFAULT_PRE_FLIGHT_SUGGESTIONS;
  }

  /** Convert to a plain object suitable for embedding in a chat error body. */
  toPayload() {
    return {
      ctx: this.ctx,
      minOutputTokens: this.minOutputTokens,
      model: this.model,
      promptTokens: this.promptTokens,
      shortBy: this.shortBy,
      suggestions: [...this.suggestions],
      type: this.type,
    };
  }
}

const estimatePayloadInputTokens = (payload: Pick<ChatStreamPayload, 'messages' | 'tools'>) => {
  const { messages = [], tools } = payload;
  const messagesText = JSON.stringify(messages);
  const toolsText = tools && tools.length > 0 ? JSON.stringify(tools) : '';
  return estimateTokenCount(messagesText) + (toolsText ? estimateTokenCount(toolsText) : 0);
};

/**
 * Resolve a safe `max_tokens` for providers whose API enforces
 * `input_tokens + max_tokens <= context_window` (e.g. MiniMax).
 *
 * - If the user explicitly passed `max_tokens`, return it untouched.
 * - Otherwise compute `min(maxOutput, contextWindow - estimatedInput - buffer)`.
 * - If the resulting value would be smaller than `minOutputTokens`, throw
 *   `ContextExceededPreFlightError` so callers can surface a clear error
 *   before issuing a doomed request.
 */
export const resolveSafeMaxTokens = (
  payload: Pick<ChatStreamPayload, 'max_tokens' | 'messages' | 'model' | 'tools'>,
  models: AiFullModelCard[],
  options: ResolveSafeMaxTokensOptions = {},
): number | undefined => {
  if (payload.max_tokens !== undefined) return payload.max_tokens;

  const model = models.find((m) => m.id === payload.model);
  if (!model) return undefined;

  const maxOutput = model.maxOutput;
  const contextWindow = model.contextWindowTokens;

  // Without contextWindow info, fall back to the model's maxOutput.
  if (!contextWindow) return maxOutput;

  const bufferTokens = options.bufferTokens ?? DEFAULT_MAX_TOKENS_BUFFER;
  const minOutputTokens = options.minOutputTokens ?? DEFAULT_MIN_OUTPUT_TOKENS;

  const estimatedInputTokens = estimatePayloadInputTokens(payload);
  const remaining = contextWindow - estimatedInputTokens - bufferTokens;

  if (remaining < minOutputTokens) {
    throw new ContextExceededPreFlightError({
      ctx: contextWindow,
      minOutputTokens,
      model: payload.model,
      promptTokens: estimatedInputTokens,
    });
  }

  return maxOutput !== undefined ? Math.min(maxOutput, remaining) : remaining;
};

/**
 * Pre-flight check for providers where the harness does not need to cap
 * `max_tokens` itself (the upstream picks its own default), but we still
 * want to bail fast when the prompt alone already overflows the model's
 * context window.
 *
 * Behaviour mirrors `resolveSafeMaxTokens` but doesn't mutate the payload
 * or compute a capped `max_tokens` value — it only throws.
 */
export const assertContextWithinWindow = (
  payload: Pick<ChatStreamPayload, 'messages' | 'model' | 'tools'>,
  models: AiFullModelCard[],
  options: ResolveSafeMaxTokensOptions = {},
): void => {
  const model = models.find((m) => m.id === payload.model);
  if (!model) return;

  const contextWindow = model.contextWindowTokens;
  if (!contextWindow) return;

  const bufferTokens = options.bufferTokens ?? DEFAULT_MAX_TOKENS_BUFFER;
  const minOutputTokens = options.minOutputTokens ?? DEFAULT_MIN_OUTPUT_TOKENS;

  const estimatedInputTokens = estimatePayloadInputTokens(payload);
  const remaining = contextWindow - estimatedInputTokens - bufferTokens;

  if (remaining < minOutputTokens) {
    throw new ContextExceededPreFlightError({
      ctx: contextWindow,
      minOutputTokens,
      model: payload.model,
      promptTokens: estimatedInputTokens,
    });
  }
};
