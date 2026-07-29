/**
 * Shared helpers for transcript parsers.
 */

const NUL = String.fromCodePoint(0);

/**
 * Postgres rejects NUL characters in text/jsonb columns, and real-world
 * transcripts do contain them (e.g. binary tool output). Deep-strip real NUL
 * characters from every string in the value (literal `\u0000` escape sequences
 * that appear as text in code snippets are untouched).
 */
export const stripNulDeep = <T>(value: T): T => {
  if (typeof value === 'string')
    return (value.includes(NUL) ? value.replaceAll(NUL, '') : value) as T;
  if (Array.isArray(value)) return value.map((item) => stripNulDeep(item)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripNulDeep(v)])) as T;
  return value;
};

/**
 * Parse a JSONL transcript into records, silently skipping unparsable lines
 * (truncated writes, corrupt tails).
 */
export const parseJsonlRecords = (content: string): any[] => {
  const records: any[] = [];
  for (const line of content.split('\n')) {
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      /* skip bad line */
    }
  }
  return records;
};

/**
 * Timestamp fingerprint of a transcript's main conversation: the last raw
 * record of the given kind. The picker compares a fresh digest's `endAt` with
 * the `sourceEndAt` stored at import time to decide whether a session grew
 * ("New messages"), so BOTH must be produced by this one helper — deriving one
 * of them from the normalized messages instead makes them disagree (assistant
 * records sharing a `message.id` merge onto the first record's timestamp) and
 * every imported session then looks perpetually out of sync.
 */
export const transcriptEndAt = (
  records: any[],
  isConversational: (record: any) => boolean,
): string | undefined => records.findLast((r) => isConversational(r))?.timestamp;

export const truncateTitle = (text: string | undefined, max = 50): string | undefined => {
  const cleaned = text?.replaceAll(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
};

/**
 * Convert a raw Anthropic-shape usage object (Claude Code transcripts) into
 * the LobeHub `ModelUsage` shape stored in the messages `usage` column —
 * same mapping as the live adapter's `toUsageData`. Non-token extras
 * (`service_tier`, `speed`, `cache_creation`, …) must NOT land here; callers
 * relocate the meaningful ones into message metadata.
 */
export const toModelUsageFromAnthropic = (
  raw:
    | {
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
      }
    | null
    | undefined,
): Record<string, number> | undefined => {
  if (!raw) return undefined;
  const inputCacheMissTokens = raw.input_tokens || 0;
  const inputCachedTokens = raw.cache_read_input_tokens || 0;
  const inputWriteCacheTokens = raw.cache_creation_input_tokens || 0;
  const totalInputTokens = inputCacheMissTokens + inputCachedTokens + inputWriteCacheTokens;
  const totalOutputTokens = raw.output_tokens || 0;
  if (totalInputTokens + totalOutputTokens === 0) return undefined;
  return {
    inputCacheMissTokens,
    ...(inputCachedTokens ? { inputCachedTokens } : {}),
    ...(inputWriteCacheTokens ? { inputWriteCacheTokens } : {}),
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };
};

/**
 * Convert a Codex `token_count` usage object (`info.last_token_usage`) into
 * the LobeHub `ModelUsage` shape. Codex `input_tokens` INCLUDES the cached
 * portion, unlike Anthropic's cache-miss-only `input_tokens`.
 */
export const toModelUsageFromCodex = (
  raw:
    | {
        cached_input_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
        reasoning_output_tokens?: number;
        total_tokens?: number;
      }
    | null
    | undefined,
): Record<string, number> | undefined => {
  if (!raw) return undefined;
  const totalInputTokens = raw.input_tokens || 0;
  const inputCachedTokens = raw.cached_input_tokens || 0;
  const totalOutputTokens = raw.output_tokens || 0;
  if (totalInputTokens + totalOutputTokens === 0) return undefined;
  const outputReasoningTokens = raw.reasoning_output_tokens || 0;
  return {
    ...(inputCachedTokens
      ? { inputCacheMissTokens: totalInputTokens - inputCachedTokens, inputCachedTokens }
      : {}),
    ...(outputReasoningTokens ? { outputReasoningTokens } : {}),
    totalInputTokens,
    totalOutputTokens,
    totalTokens: raw.total_tokens || totalInputTokens + totalOutputTokens,
  };
};
