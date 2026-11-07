// cspell:ignore tokenx
import { estimateTokenCount } from 'tokenx';

import { DEFAULT_DRIFT_MULTIPLIER } from './constants';

/**
 * Flat estimate for one image / video / audio part. Providers bill media by
 * pixels or duration, not by the bytes of its URL, so estimating the URL text
 * would count a base64 data URI as hundreds of thousands of tokens. Anthropic
 * bills a ~1000×1000 image at ~1.3k tokens.
 */
export const MEDIA_PART_TOKENS = 1500;

const estimateText = (value: unknown): number => {
  if (value == null) return 0;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text ? estimateTokenCount(text) : 0;
};

const estimateContent = (content: unknown): number => {
  if (!Array.isArray(content)) return estimateText(content);

  let total = 0;
  for (const part of content as Array<{ text?: unknown; type?: string }>) {
    total += part?.type === 'text' ? estimateText(part.text) : MEDIA_PART_TOKENS;
  }
  return total;
};

interface RequestMessage {
  content?: unknown;
  reasoning?: { content?: unknown } | string;
  reasoning_content?: unknown;
  tool_call_id?: unknown;
  tool_calls?: Array<{ function?: { arguments?: unknown; name?: unknown }; id?: unknown }>;
}

export interface EstimateRequestTokensParams {
  /** Drift multiplier applied to the raw estimate. @default DEFAULT_DRIFT_MULTIPLIER */
  driftMultiplier?: number;
  /** Messages as sent to the provider (context engine output, OpenAI format) */
  messages: unknown[];
  /** Tool definitions sent with the request */
  tools?: unknown[];
}

export interface RequestTokenEstimate {
  /** `rawTotal × driftMultiplier`, the figure to compare against a budget */
  adjustedTotal: number;
  rawTotal: number;
}

/**
 * Estimate the input tokens of one provider request from what is actually
 * sent: the context engine's output messages plus tool definitions.
 *
 * {@link countContextTokens} accounts stored UI messages *before* the context
 * engine runs, so it cannot see what the engine trims, truncates or injects.
 * Budget checks that must match the real request use this estimator instead.
 */
export const estimateRequestTokens = ({
  driftMultiplier = DEFAULT_DRIFT_MULTIPLIER,
  messages,
  tools = [],
}: EstimateRequestTokensParams): RequestTokenEstimate => {
  let rawTotal = 0;

  for (const message of messages as RequestMessage[]) {
    if (!message) continue;

    rawTotal += estimateContent(message.content);
    rawTotal += estimateText(message.tool_call_id);
    rawTotal += estimateText(message.reasoning_content);

    const { reasoning } = message;
    rawTotal += estimateText(typeof reasoning === 'string' ? reasoning : reasoning?.content);

    for (const toolCall of message.tool_calls ?? []) {
      rawTotal += estimateText(toolCall.id);
      rawTotal += estimateText(toolCall.function?.name);
      rawTotal += estimateText(toolCall.function?.arguments);
    }
  }

  for (const tool of tools) rawTotal += estimateText(tool);

  return { adjustedTotal: Math.ceil(rawTotal * driftMultiplier), rawTotal };
};
