import { countContextTokens, DEFAULT_DRIFT_MULTIPLIER } from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';

/**
 * Options for token counting and compression threshold calculation
 */
export interface TokenCountOptions {
  /**
   * Optional drift multiplier override forwarded to {@link countContextTokens}.
   * Default {@link DEFAULT_DRIFT_MULTIPLIER} (1.25).
   */
  driftMultiplier?: number;
  /** Model's max context window token count */
  maxWindowToken?: number;
  /** Threshold ratio for triggering compression, default 0.5 */
  thresholdRatio?: number;
  /**
   * Optional top-level tool definitions for the upcoming LLM call. When
   * provided, tool definition tokens are counted toward the budget — matches
   * what the provider actually charges. Pass the same `tools` array that will
   * be sent in the request payload.
   */
  tools?: unknown[];
}

/** Default max context window (128k tokens) */
export const DEFAULT_MAX_CONTEXT = 128_000;

/** Default threshold ratio (50% of max context) */
export const DEFAULT_THRESHOLD_RATIO = 0.5;

/**
 * Calculate the compression threshold based on max context window
 */
export function getCompressionThreshold(options: TokenCountOptions = {}): number {
  const maxContext = options.maxWindowToken ?? DEFAULT_MAX_CONTEXT;
  const ratio = options.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO;
  return Math.floor(maxContext * ratio);
}

/**
 * Result of compression check
 */
export interface CompressionCheckResult {
  /**
   * Best raw estimate of current input tokens (sum of message content +
   * tool calls + reasoning + tool_call_id + tool definitions).
   */
  currentTokenCount: number;
  /**
   * `true` when `adjustedTokenCount > threshold`. The adjusted count includes
   * a drift multiplier (default 1.25×) to compensate for the gap between
   * `tokenx`'s heuristic and provider tokenizers, so compression fires before
   * upstream tokenizers actually overflow the model's context window.
   */
  needsCompression: boolean;
  /** Compression threshold (`maxWindowToken × thresholdRatio`) */
  threshold: number;
}

/**
 * Check if messages need compression based on token count.
 *
 * Uses {@link countContextTokens} under the hood, so the input estimate
 * accounts for tool calls, reasoning, and tool definitions in addition to
 * `content` (see LOBE-8964 for the calibration data).
 */
export function shouldCompress(
  messages: UIChatMessage[],
  options: TokenCountOptions = {},
): CompressionCheckResult {
  const accounting = countContextTokens({
    messages,
    options: { driftMultiplier: options.driftMultiplier ?? DEFAULT_DRIFT_MULTIPLIER },
    tools: options.tools,
  });
  const threshold = getCompressionThreshold(options);

  return {
    currentTokenCount: accounting.rawTotal,
    needsCompression: accounting.adjustedTotal > threshold,
    threshold,
  };
}
