// cspell:ignore tokenx
import { estimateTokenCount } from 'tokenx';

/**
 * Heuristic token count of a text, from `tokenx`. It is tokenizer-agnostic:
 * compared with provider-reported usage it runs close for GPT- and
 * DeepSeek-family models and roughly 30–40% low for Claude, so treat it as an
 * estimate, never as billing. `resolveInputTokenRatio` converts it to a model's tokens.
 */
export const estimateTextTokens = (text: string | undefined | null): number =>
  text ? estimateTokenCount(text) : 0;

/** {@link estimateTextTokens} of a value, JSON-serialized unless it is a string. */
export const estimateSerializableTokens = (value: unknown): number => {
  if (value === undefined || value === null) return 0;

  return estimateTextTokens(typeof value === 'string' ? value : JSON.stringify(value));
};
