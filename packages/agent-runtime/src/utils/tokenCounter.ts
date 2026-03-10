import { estimateTokenCount } from 'tokenx';

/**
 * Options for token counting and compression threshold calculation
 */
export interface TokenCountOptions {
  /** Model's max context window token count */
  maxWindowToken?: number;
  /** Threshold ratio for triggering compression, default 0.75 */
  thresholdRatio?: number;
}

/** Default max context window (128k tokens) */
export const DEFAULT_MAX_CONTEXT = 128_000;

/** Default threshold ratio (50% of max context) */
export const DEFAULT_THRESHOLD_RATIO = 0.5;

/**
 * Message interface for token counting
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
 * - User/System messages: Use tokenx estimation
 *
 * @param messages - List of messages to count tokens for
 * @returns Total token count
 */
export function calculateMessageTokens(messages: TokenCountMessage[]): number {
  return messages.reduce((total, msg) => {
    // For assistant messages, prefer the recorded token count from usage metadata
    if (msg.role === 'assistant') {
      const outputTokens = msg.metadata?.usage?.totalOutputTokens;
      if (outputTokens && outputTokens > 0) {
        return total + outputTokens;
      }
    }

    // For user/system messages or assistant messages without usage data, estimate tokens
    return total + estimateTokens(msg.content);
  }, 0);
}

/**
 * Calculate the compression threshold based on max context window
 * @param options - Token count options
 * @returns Compression threshold in tokens
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
