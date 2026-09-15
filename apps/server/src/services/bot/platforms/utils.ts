import { DEFAULT_BOT_DEBOUNCE_MS } from '@lobechat/const';
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

// --------------- Concurrency resolution ---------------

export type BotConcurrencyStrategy = 'burst' | 'debounce' | 'queue';

export interface ResolvedBotConcurrency {
  /** Collection window, in ms. Ignored by `queue`, which dispatches at once. */
  debounceMs: number;
  strategy: BotConcurrencyStrategy;
}

/**
 * Platforms that deliver one logical turn as several messages. WeChat sends an
 * image and the sentence about it as two webhooks a few hundred ms apart, so
 * there is no useful immediate-dispatch mode: `queue` answers the picture
 * before the question has arrived, which starts an incomplete turn. Their
 * schema offers `burst` and `debounce` only.
 */
const TURN_COLLECTING_PLATFORMS = new Set(['wechat']);

/**
 * Decide how the Chat SDK should handle overlapping messages for one channel.
 *
 * A channel created before `burst` existed has `concurrency: 'queue'` baked
 * into its stored settings by `mergeBotSettingsForPersist`, so a schema default
 * alone would never reach it. Resolving it here fixes every existing channel
 * without rewriting anyone's saved settings, and reverts with the code.
 *
 * The stored window is deliberately dropped along with it: `debounceMs` is
 * hidden in the form while a channel sits on `queue` and is never read at
 * runtime, so whatever it holds is a stale default rather than a choice. Under
 * `burst` that window delays every single reply, and the value these rows carry
 * is the old 5s one.
 *
 * An explicit `debounce` is left exactly as the operator set it.
 */
export function resolveBotConcurrency(
  platform: string,
  settings: Record<string, unknown> | null | undefined,
): ResolvedBotConcurrency {
  const stored = typeof settings?.concurrency === 'string' ? settings.concurrency : undefined;
  const storedWindow =
    typeof settings?.debounceMs === 'number' && settings.debounceMs > 0
      ? settings.debounceMs
      : undefined;

  if (TURN_COLLECTING_PLATFORMS.has(platform) && (stored === undefined || stored === 'queue')) {
    return { debounceMs: DEFAULT_BOT_DEBOUNCE_MS, strategy: 'burst' };
  }

  const strategy: BotConcurrencyStrategy =
    stored === 'burst' || stored === 'debounce' ? stored : 'queue';

  return { debounceMs: storedWindow ?? DEFAULT_BOT_DEBOUNCE_MS, strategy };
}

/**
 * Project a provider's stored settings onto what the runtime will actually do,
 * for the settings form to render.
 *
 * A channel created before `burst` existed stores `concurrency: 'queue'`, which
 * its platform no longer offers. Handing that to the form renders a bare
 * `queue` in the picker, and — worse — saving the untouched form would persist
 * the stale window next to a strategy that DOES read it, putting the old 5s
 * wait in front of every reply. Only rows the runtime actually overrides are
 * rewritten; every other channel is passed through untouched.
 */
export function withResolvedConcurrencySettings(
  platform: string,
  settings: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  const stored = settings?.concurrency;
  if (typeof stored !== 'string') return settings;

  const resolved = resolveBotConcurrency(platform, settings);
  if (resolved.strategy === stored) return settings;

  return { ...settings, concurrency: resolved.strategy, debounceMs: resolved.debounceMs };
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

/**
 * The platform a `platformThreadId` belongs to.
 *
 * Thread ids are platform-prefixed (`wechat:…`, `discord:…`), which is the
 * only thing tying a live conversation back to its platform once it is in
 * flight — and therefore what routes gateway calls to the host that owns the
 * connection. Passes `undefined` through so optional bot contexts can hand
 * their thread id over without a guard at every call site.
 */
export function platformFromThreadId(platformThreadId: string): string;
export function platformFromThreadId(platformThreadId: string | undefined): string | undefined;
export function platformFromThreadId(platformThreadId?: string): string | undefined {
  return platformThreadId?.split(':')[0];
}
