import { merge } from '@lobechat/utils';

import type {
  BotProviderConfig,
  ConnectionMode,
  FieldSchema,
  PlatformDefinition,
  UsageStats,
} from './types';

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
 * Resolve the effective connection mode for a single provider.
 *
 * Resolution order:
 * 1. Explicit `settings.connectionMode` (set when the user saves the form,
 *    or injected by `mergeWithDefaults` from `field.default` in the schema).
 * 2. `platform.connectionMode` — the platform's runtime default.
 * 3. `'webhook'` if the platform is unknown.
 *
 * Callers should always pass settings that have been merged with schema
 * defaults — use `resolveConnectionMode` (in this file) instead of calling
 * this directly with raw DB settings.
 */
export function getEffectiveConnectionMode(
  platform: PlatformDefinition | undefined,
  settings: Record<string, unknown> | null | undefined,
): ConnectionMode {
  const fromSettings = settings?.connectionMode as ConnectionMode | undefined;
  if (fromSettings) return fromSettings;

  return platform?.connectionMode ?? 'webhook';
}

// --------------- Provider config resolution ---------------

/**
 * Minimal shape needed to resolve a provider's runtime config. Matches the
 * relevant subset of a decrypted `agentBotProviders` row.
 */
export interface ProviderConfigInput {
  applicationId: string;
  credentials: Record<string, string>;
  settings?: Record<string, unknown> | null;
}

export interface ResolvedBotProviderConfig {
  /** Ready-to-use BotProviderConfig with merged settings. */
  config: BotProviderConfig;
  /** Effective connection mode derived from the merged settings. */
  connectionMode: ConnectionMode;
  /** Merged settings (schema defaults overlaid with user overrides). */
  settings: Record<string, unknown>;
}

/**
 * Canonical way to turn a stored provider row into a runtime config.
 *
 * Every code path that creates a PlatformClient or decides connection mode
 * should go through here so that:
 *   1. Schema defaults (`field.default`) are always applied — the UI shows
 *      these values, so the runtime must agree.
 *   2. Connection mode is resolved from the merged settings, not from the
 *      raw DB row that may pre-date the `connectionMode` field.
 */
export function resolveBotProviderConfig(
  platform: PlatformDefinition,
  provider: ProviderConfigInput,
): ResolvedBotProviderConfig {
  const settings = mergeWithDefaults(platform.schema, provider.settings);
  const connectionMode = getEffectiveConnectionMode(platform, settings);

  return {
    config: {
      applicationId: provider.applicationId,
      credentials: provider.credentials,
      platform: platform.id,
      settings,
    },
    connectionMode,
    settings,
  };
}

/**
 * Resolve the effective connection mode for a stored provider, applying
 * schema defaults first. Use this when only the mode is needed (e.g. routing
 * decisions without instantiating a client). For full client config, use
 * `resolveBotProviderConfig`.
 */
export function resolveConnectionMode(
  platform: PlatformDefinition | undefined,
  rawSettings: Record<string, unknown> | null | undefined,
): ConnectionMode {
  if (!platform) return getEffectiveConnectionMode(undefined, rawSettings);
  const settings = mergeWithDefaults(platform.schema, rawSettings);
  return getEffectiveConnectionMode(platform, settings);
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
