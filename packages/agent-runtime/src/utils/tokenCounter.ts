import type { UIChatMessage } from '@lobechat/types';
import { extractMessageContent } from '@lobechat/utils';
import { estimateTokenCount } from 'tokenx';

/**
 * Compression mode type
 */
export type CompressionMode = 'disabled' | 'economy' | 'full';

/**
 * Compression strategy type (excludes 'disabled')
 * Used when compression is enabled to specify the compression strategy
 */
export type CompressionStrategy = Exclude<CompressionMode, 'disabled'>;

/**
 * Resolve context compression mode with backward compatibility
 *
 * Supports legacy `enableContextCompression` boolean and new `contextCompressionMode` enum.
 * Priority: contextCompressionMode > enableContextCompression > default ('economy')
 *
 * @param options - Configuration options
 * @param options.contextCompressionMode - New enum-based compression mode
 * @param options.enableContextCompression - Legacy boolean flag (deprecated)
 * @returns Resolved compression mode
 */
export function resolveCompressionMode(options: {
  contextCompressionMode?: CompressionMode;
  enableContextCompression?: boolean;
}): CompressionMode {
  // Prefer new contextCompressionMode if set
  if (options.contextCompressionMode !== undefined) {
    return options.contextCompressionMode;
  }

  // Fall back to legacy enableContextCompression flag
  // Legacy true → 'economy' (50% threshold, 128k cap for better token efficiency)
  // Legacy false → 'disabled' (no compression)
  // Default to 'economy' when both are undefined
  return (options.enableContextCompression ?? true) ? 'economy' : 'disabled';
}

/**
 * Options for token counting and compression threshold calculation
 */
export interface TokenCountOptions {
  /** Model's max context window token count */
  maxWindowToken?: number;
  /** Compression mode: 'economy' limits context to 128k/50%, 'full' uses model context/70% */
  mode?: CompressionMode;
  /** Threshold ratio for triggering compression, default 0.7 */
  thresholdRatio?: number;
}

/** Default max context window (128k tokens) */
export const DEFAULT_MAX_CONTEXT = 128_000;

/**
 * Economy mode context window cap (128k tokens)
 * For large context models (e.g., 1M), cap at 128k to limit token consumption.
 * For small context models (< 128k), use the model's actual context window.
 */
export const ECONOMY_MAX_CONTEXT = 128_000;

/**
 * Minimum buffer required for compression process
 *
 * Compression needs:
 * - Input messages (at threshold): ~threshold tokens
 * - Compressed output: ~30-40% of input
 * - System prompt: ~800 tokens
 *
 * For 128k context at 70%: 89.6k (input) + ~30k (output) + 800 ≈ 120k < 128k (safe)
 * For 32k context at 70%: 22.4k (input) + ~8k (output) + 800 ≈ 31.2k > 32k (NOT safe)
 *
 * Setting MIN_COMPRESSION_BUFFER to 20k ensures:
 * - Small context models (≤64k) have enough buffer for compression
 * - Large context models (≥128k) still use the optimal 70% threshold
 */
export const MIN_COMPRESSION_BUFFER = 20_000;

/**
 * Default threshold ratio (70% of max context)
 *
 * Rationale:
 * - 70% provides a good balance between utilizing context window and leaving room for compression
 * - At 70% of 128k = 89.6k, compression needs ~89.6k (input) + ~27k (output) ≈ 117k < 128k (safe)
 * - At 70% of 200k = 140k, compression needs ~140k (input) + ~42k (output) ≈ 182k < 200k (safe)
 * - Higher than 50% to avoid premature compression, but lower than 90% to ensure compression process has buffer
 */
export const DEFAULT_THRESHOLD_RATIO = 0.7;

/**
 * Economy threshold ratio (50% of max context)
 *
 * Rationale:
 * - 50% compresses early to save tokens for long conversations
 * - At 50% of 128k = 64k, compression needs ~64k (input) + ~19k (output) ≈ 83k < 128k (safe)
 * - Suitable for users who prioritize token savings over context retention
 */
export const ECONOMY_THRESHOLD_RATIO = 0.5;

/**
 * Message interface for token counting
 * Accepts both standard messages and virtual message types (UIChatMessage)
 */
export interface TokenCountMessage {
  content?: string | unknown;
  metadata?: {
    usage?: {
      totalOutputTokens?: number;
    };
  } | null;
  role: string;
}

/**
 * Estimate token count for text content using tokenx
 * @param content - Text content or object to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(content: string | unknown): number {
  // Handle null/undefined early
  if (content === null || content === undefined) return 0;

  const text = typeof content === 'string' ? content : JSON.stringify(content);
  if (!text) return 0;
  return estimateTokenCount(text);
}

/**
 * Calculate total token count for a list of messages
 * - Assistant messages: Use metadata.usage.totalOutputTokens if available (exact value)
 * - All messages: Use extractMessageContent to handle virtual message types
 *
 * @param messages - List of messages to count tokens for
 * @returns Total token count
 */
export function calculateMessageTokens(messages: TokenCountMessage[]): number {
  return messages.reduce((total, msg) => {
    if (msg.role === 'assistant') {
      const outputTokens = msg.metadata?.usage?.totalOutputTokens;
      if (outputTokens && outputTokens > 0) {
        return total + outputTokens;
      }
    }

    const content = extractMessageContent(msg as UIChatMessage);
    return total + estimateTokens(content);
  }, 0);
}

/**
 * Calculate the compression threshold based on max context window
 *
 * Applies minimum buffer protection for small context models:
 * - For models with context ≤ 20k: disabled (returns maxContext, effectively disabling auto-compression)
 * - For models with context ≤ 64k: uses conservative threshold to ensure 20k buffer
 * - For models with context ≥ 128k: uses optimal threshold based on mode
 *
 * @param options - Token count options
 * @returns Compression threshold in tokens
 */
export function getCompressionThreshold(options: TokenCountOptions = {}): number {
  const modelContext = options.maxWindowToken ?? DEFAULT_MAX_CONTEXT;

  // Disabled mode: return maxContext to effectively disable compression
  if (options.mode === 'disabled') {
    return modelContext;
  }

  // Determine effective context window and threshold ratio based on mode
  // Economy mode: cap context at 128k for large models to limit token consumption
  // Full mode: use model's actual context window
  const isEconomy = options.mode === 'economy';
  const maxContext = isEconomy ? Math.min(modelContext, ECONOMY_MAX_CONTEXT) : modelContext;
  const ratio = isEconomy
    ? ECONOMY_THRESHOLD_RATIO
    : (options.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO);

  // Calculate base threshold
  const threshold = Math.floor(maxContext * ratio);

  // Apply minimum buffer protection for compression process
  // Compression needs: input (threshold) + output (~35% of input) + system prompt (~800)
  const maxSafeThreshold = maxContext - MIN_COMPRESSION_BUFFER;

  // For very small context models (< 20k), disable auto-compression
  if (maxSafeThreshold <= 0) {
    return maxContext;
  }

  return Math.min(threshold, maxSafeThreshold);
}

/**
 * Result of compression check
 */
export interface CompressionCheckResult {
  /** Current total token count */
  currentTokenCount: number;
  /** Whether compression is needed */
  needsCompression: boolean;
  /** Compression threshold */
  threshold: number;
}

/**
 * Check if messages need compression based on token count
 * @param messages - List of messages to check
 * @param options - Token count options
 * @returns Compression check result
 */
export function shouldCompress(
  messages: TokenCountMessage[],
  options: TokenCountOptions = {},
): CompressionCheckResult {
  const currentTokenCount = calculateMessageTokens(messages);
  const threshold = getCompressionThreshold(options);

  return {
    currentTokenCount,
    needsCompression: currentTokenCount > threshold,
    threshold,
  };
}
