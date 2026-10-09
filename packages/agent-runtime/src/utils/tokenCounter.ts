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
 * Optional sink for compression-check telemetry. Assigned by the host app so
 * this shared package never imports a server logger. Called once per
 * shouldCompress call with a plain object, safe to ignore.
 */
export type CompressionTelemetrySink = (event: {
  /** per-source raw token breakdown */
  bySource: Record<string, number>;
  /** estimated tokens before drift multiplier */
  currentTokenCount: number;
  /** number of messages in the candidate context */
  messageCount: number;
  /** effective maxWindowToken basis (after any budget clamp) */
  maxWindowToken?: number;
  /** whether compression will run */
  needsCompression: boolean;
  /** raw vs adjusted milestone total */
  threshold: number;
  /** count of tool definitions contributing to the estimate */
  toolDefinitionCount?: number;
}) => void;

let telemetrySink: CompressionTelemetrySink | undefined;

export function setCompressionTelemetrySink(sink?: CompressionTelemetrySink) {
  telemetrySink = sink;
}


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
 * `content` (see for the calibration data).
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

  telemetrySink?.({
    bySource: accounting.bySource,
    currentTokenCount: accounting.rawTotal,
    messageCount: messages.length,
    maxWindowToken: options.maxWindowToken,
    needsCompression: accounting.adjustedTotal > threshold,
    threshold,
    toolDefinitionCount: Array.isArray(options.tools) ? options.tools.length : 0,
  });

  return {
    currentTokenCount: accounting.rawTotal,
    needsCompression: accounting.adjustedTotal > threshold,
    threshold,
  };
}
