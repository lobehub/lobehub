import type { ChatStreamPayload } from '../../types';

const smallContextWindowPatterns = [
  /claude-3-opus-20240229/,
  /claude-3-haiku-20240307/,
  /claude-v2(:1)?$/,
];

/**
 * Resolve the max_tokens value to align Anthropic and Bedrock behavior.
 * Priority: user input > model-bank default maxOutput > hardcoded fallback (context-window aware).
 */
export const resolveMaxTokens = async ({
  max_tokens,
  model,
  thinking,
  providerModels,
}: {
  max_tokens?: number;
  model: string;
  providerModels: { id: string; maxOutput?: number }[];
  thinking?: ChatStreamPayload['thinking'];
}) => {
  const defaultMaxOutput = providerModels.find((m) => m.id === model)?.maxOutput;

  const preferredMaxTokens = max_tokens ?? defaultMaxOutput;

  if (preferredMaxTokens) return preferredMaxTokens;

  if (thinking?.type === 'enabled') return 32_000;
  if (thinking?.type === 'adaptive') return 64_000;

  const hasSmallContextWindow = smallContextWindowPatterns.some((pattern) => pattern.test(model));

  return hasSmallContextWindow ? 4096 : 8192;
};
