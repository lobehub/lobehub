import type { ContextTokenAccounting } from '@lobechat/context-engine';
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
 * Backstop on the whole request, as a share of the window, independent of
 * {@link DEFAULT_THRESHOLD_RATIO}.
 *
 * The ratio threshold is a conversation budget and the headroom above it already
 * covers this overhead plus the completion, so on a normal run the ratio is what
 * fires. This ceiling exists for the case the ratio cannot cover: overhead so
 * large on its own that the conversation budget is already spent. Compressing
 * the transcript is the wrong remedy there — it cannot shrink a tool manifest —
 * but overshooting the window is worse than a wasted summary, so we still fire.
 */
export const MAX_PROMPT_RATIO = 0.8;

/**
 * The prompt tokens a step pays before the conversation contributes anything:
 * the injected system role plus the top-level tool definitions.
 *
 * Both are re-sent in full on every request regardless of transcript length, and
 * an agent with a broad tool surface pays a lot for them — a measured run shipped
 * 17.9k system-role tokens and 17.1k tool-definition tokens, 43.7k of a 64k
 * budget, before the user typed a word.
 */
const countFixedOverhead = (accounting: ContextTokenAccounting): number => {
  const systemRoleTokens = accounting.messages
    .filter((message) => message.role === 'system')
    .reduce((total, message) => total + (message.bySource.content ?? 0), 0);

  return systemRoleTokens + accounting.bySource.toolDefinition;
};

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
   * Tokens the request pays for the system role and tool definitions, excluded
   * from the conversation budget — see {@link shouldCompress}.
   */
  fixedOverhead: number;
  /**
   * `true` when `adjustedTokenCount` exceeds either the conversation budget
   * (`threshold + fixedOverhead`) or the absolute `MAX_PROMPT_RATIO` ceiling.
   * The adjusted count includes a drift multiplier (default 1.25×) to
   * compensate for the gap between `tokenx`'s heuristic and provider tokenizers,
   * so compression fires before upstream tokenizers actually overflow the
   * model's context window.
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
 *
 * The threshold is a budget for the *conversation*, so the per-step overhead is
 * added back before the comparison. The caller (`GeneralChatAgent`) already
 * reserves the headroom above the threshold for server-side context engineering
 * — the comment on `DEFAULT_RECOMPRESSION_THRESHOLD_RATIO` budgets 35% of the
 * window for "system role, knowledge, memories, skills" plus the completion —
 * but that overhead arrives inside `messages` and `tools`, so counting it
 * against the threshold charged it to the conversation side as well. A tooled
 * agent then ran out of budget after ~29k tokens of actual dialogue. A
 * conversation-only threshold also stops summarizing the transcript to make room
 * for a system prompt that compression cannot shrink.
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
  const fixedOverhead = countFixedOverhead(accounting);
  const maxContext = options.maxWindowToken ?? DEFAULT_MAX_CONTEXT;

  return {
    currentTokenCount: accounting.rawTotal,
    fixedOverhead,
    needsCompression:
      accounting.adjustedTotal > threshold + fixedOverhead ||
      accounting.adjustedTotal > Math.floor(maxContext * MAX_PROMPT_RATIO),
    threshold,
  };
}
