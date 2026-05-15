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
  /**
   * Only populated by `resolveSafeMaxTokens` (max_tokens-capping path). The
   * pre-flight-only `assertContextWithinWindow` leaves it undefined since
   * it does not require headroom for completion to consider the prompt
   * valid.
   */
  readonly minOutputTokens?: number;
  readonly suggestions: readonly PreFlightSuggestion[];

  constructor(params: {
    ctx: number;
    minOutputTokens?: number;
    model: string;
    promptTokens: number;
    suggestions?: readonly PreFlightSuggestion[];
  }) {
    const { model, ctx, promptTokens, minOutputTokens, suggestions } = params;
    const shortBy = promptTokens - ctx;
    const message =
      minOutputTokens !== undefined
        ? `Prompt tokens (${promptTokens}) leave less than ${minOutputTokens} tokens for completion within the model context window (${ctx}) for model "${model}". Reduce input or attached tools, or pick a model with a larger context window.`
        : `Prompt tokens (${promptTokens}) exceed the model context window (${ctx}) for model "${model}". Reduce input or attached tools, or pick a model with a larger context window.`;
    super(message);
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
      model: this.model,
      promptTokens: this.promptTokens,
      shortBy: this.shortBy,
      suggestions: [...this.suggestions],
      type: this.type,
      ...(this.minOutputTokens !== undefined ? { minOutputTokens: this.minOutputTokens } : {}),
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

export interface AssertContextWithinWindowOptions {
  /**
   * Number of tokens to subtract from the model context window before
   * comparing against the estimated prompt size. Use a small positive
   * value to be conservative against estimator drift / per-message
   * protocol overhead that `tokenx` doesn't model. Default `0` — only
   * reject when the estimated prompt strictly exceeds the model window.
   */
  safetyMarginTokens?: number;
}

/**
 * Pre-flight check for providers where the harness does not need to cap
 * `max_tokens` itself (the upstream picks its own default), but we still
 * want to bail fast when the prompt alone already overflows the model's
 * context window.
 *
 * Unlike `resolveSafeMaxTokens` this does NOT require headroom for
 * completion — the upstream will pick its own `max_tokens` default once
 * the request is dispatched. Rejecting near-limit-but-fitting prompts
 * (e.g. 198.5k tokens against a 200k window) would block valid requests
 * that the upstream would happily serve. See LOBE-8974 review feedback.
 */
export const assertContextWithinWindow = (
  payload: Pick<ChatStreamPayload, 'messages' | 'model' | 'tools'>,
  models: AiFullModelCard[],
  options: AssertContextWithinWindowOptions = {},
): void => {
  const model = models.find((m) => m.id === payload.model);
  if (!model) return;

  const contextWindow = model.contextWindowTokens;
  if (!contextWindow) return;

  const safetyMarginTokens = options.safetyMarginTokens ?? 0;
  const estimatedInputTokens = estimatePayloadInputTokens(payload);

  if (estimatedInputTokens <= contextWindow - safetyMarginTokens) return;

  throw new ContextExceededPreFlightError({
    ctx: contextWindow,
    model: payload.model,
    promptTokens: estimatedInputTokens,
  });
};
