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

export interface ResolveSafeMaxTokensOptions {
  /** Safety buffer reserved on top of estimated input tokens. */
  bufferTokens?: number;
  /** Minimum acceptable `max_tokens`; below this we throw. */
  minOutputTokens?: number;
}

/**
 * Thrown when the estimated input tokens leave less room than
 * `minOutputTokens` for completion. Caught by provider-level `handleError`
 * and converted into an `ExceededContextWindow` chat error.
 */
export class MaxTokensExceededError extends Error {
  readonly contextWindowTokens: number;
  readonly estimatedInputTokens: number;
  readonly minOutputTokens: number;
  readonly modelId: string;

  constructor(params: {
    contextWindowTokens: number;
    estimatedInputTokens: number;
    minOutputTokens: number;
    modelId: string;
  }) {
    const { modelId, contextWindowTokens, estimatedInputTokens, minOutputTokens } = params;
    super(
      `Estimated input tokens (${estimatedInputTokens}) leave less than ${minOutputTokens} tokens for completion within the model context window (${contextWindowTokens}) for model "${modelId}". Reduce input or attached tools, or pick a model with a larger context window.`,
    );
    this.name = 'MaxTokensExceededError';
    this.modelId = modelId;
    this.contextWindowTokens = contextWindowTokens;
    this.estimatedInputTokens = estimatedInputTokens;
    this.minOutputTokens = minOutputTokens;
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
 *   `MaxTokensExceededError` so callers can surface a clear error before
 *   issuing a doomed request.
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
    throw new MaxTokensExceededError({
      contextWindowTokens: contextWindow,
      estimatedInputTokens,
      minOutputTokens,
      modelId: payload.model,
    });
  }

  return maxOutput !== undefined ? Math.min(maxOutput, remaining) : remaining;
};
