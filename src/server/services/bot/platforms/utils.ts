import { merge } from '@lobechat/utils';

import type { FieldSchema, UsageStats } from './types';

// --------------- Settings defaults ---------------

/**
 * Recursively extract default values from a FieldSchema.
 */
function extractFieldDefault(field: FieldSchema): unknown {
  if (field.type === 'object' && field.properties) {
    const obj: Record<string, unknown> = {};
    for (const child of field.properties) {
      const value = extractFieldDefault(child);
      if (value !== undefined) obj[child.key] = value;
    }
    return Object.keys(obj).length > 0 ? obj : undefined;
  }
  return field.default;
}

/**
 * Extract defaults from a FieldSchema array.
 *
 * Recursively walks the fields and collects all `default` values.
 */
export function extractDefaults(fields?: FieldSchema[]): Record<string, unknown> {
  if (!fields) return {};
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const value = extractFieldDefault(field);
    if (value !== undefined) result[field.key] = value;
  }
  return result;
}

/**
 * Merge platform schema defaults with user-provided settings.
 * Extracts defaults from the schema, then deep-merges with user overrides.
 *
 *   const settings = mergeWithDefaults(entry.schema, provider.settings);
 */
export function mergeWithDefaults(
  schema: FieldSchema[],
  userSettings?: Record<string, unknown> | null,
): Record<string, unknown> {
  const settingsSchema = schema.find((f) => f.key === 'settings')?.properties;
  const defaults = extractDefaults(settingsSchema);
  if (!userSettings) return defaults;
  return merge(defaults, userSettings) as Record<string, unknown>;
}

// --------------- Runtime key helpers ---------------

/**
 * Build a runtime key for a registered bot instance.
 * Format: `platform:applicationId`
 */
export function buildRuntimeKey(platform: string, applicationId: string): string {
  return `${platform}:${applicationId}`;
}

/**
 * Parse a runtime key back into its components.
 */
export function parseRuntimeKey(key: string): {
  applicationId: string;
  platform: string;
} {
  const idx = key.indexOf(':');
  return {
    applicationId: idx === -1 ? key : key.slice(idx + 1),
    platform: idx === -1 ? '' : key.slice(0, idx),
  };
}

// --------------- Formatting helpers ---------------

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

/**
 * Format usage stats into a human-readable line.
 * e.g. "1.2k tokens · $0.0312 · 3s | llm×5 | tools×4"
 */
export function formatUsageStats(stats: UsageStats): string {
  const { totalTokens, totalCost, elapsedMs, llmCalls, toolCalls } = stats;
  const time = elapsedMs && elapsedMs > 0 ? ` · ${formatDuration(elapsedMs)}` : '';
  const calls =
    (llmCalls && llmCalls > 1) || (toolCalls && toolCalls > 0)
      ? ` | llm×${llmCalls ?? 0} | tools×${toolCalls ?? 0}`
      : '';
  return `${formatTokens(totalTokens)} tokens · $${totalCost.toFixed(4)}${time}${calls}`;
}
