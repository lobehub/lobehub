import { merge } from '@lobechat/utils';

import type { ConnectionMode, FieldSchema, PlatformDefinition, UsageStats } from './types';

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

// --------------- Connection mode resolution ---------------

/**
 * Platforms that historically shipped as webhook-only and added multi-mode
 * (websocket) support later. Provider rows created before the upgrade have no
 * `settings.connectionMode` field, and must keep running on webhook to
 * preserve their original behavior — otherwise upgrading would silently break
 * every legacy bot.
 *
 * **Do NOT add brand-new multi-mode platforms here.** A platform that ships
 * with multi-mode support from day one has no legacy data to preserve, so it
 * should use `platform.connectionMode` as its runtime fallback like every
 * other platform. This list is strictly for backward-compat with rows that
 * pre-date the `connectionMode` field on a given platform.
 */
const LEGACY_WEBHOOK_PLATFORMS: ReadonlySet<string> = new Set(['slack', 'feishu', 'lark', 'qq']);

/**
 * Resolve the effective connection mode for a single provider.
 *
 * Resolution order:
 * 1. Explicit `settings.connectionMode` (set when the user saves the form)
 * 2. For platforms in `LEGACY_WEBHOOK_PLATFORMS`, fall back to `'webhook'` so
 *    legacy provider rows keep their original behavior.
 * 3. Otherwise fall back to `platform.connectionMode`, which is the platform's
 *    default runtime mode (single-mode platforms) or the recommended default
 *    for new providers (any future multi-mode platform with no legacy data).
 */
export function getEffectiveConnectionMode(
  platform: PlatformDefinition | undefined,
  settings: Record<string, unknown> | null | undefined,
): ConnectionMode {
  const fromSettings = settings?.connectionMode as ConnectionMode | undefined;
  if (fromSettings) return fromSettings;

  if (platform && LEGACY_WEBHOOK_PLATFORMS.has(platform.id)) {
    return 'webhook';
  }

  return platform?.connectionMode ?? 'webhook';
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
