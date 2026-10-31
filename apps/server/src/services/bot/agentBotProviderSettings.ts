import { assertBotFeatureAccess } from '@/business/server/bot/featureAccess';
import {
  BOT_WAKE_SETTING_KEYS,
  flattenBotWakeSettings,
  hasPassiveListeningRule,
} from '@/server/services/agentSignal/scenarios/botWake/config';
import { GatewayService } from '@/server/services/gateway';

import { getBotMessageRouter } from './BotMessageRouter';
import {
  extractWatchKeywordEntries,
  mergeWithDefaults,
  platformRegistry,
  resolveConnectionMode,
  validateAccessSettings,
} from './platforms';

/**
 * Merge schema defaults into incoming settings before persisting, so the DB
 * row always carries every declared field. Without this, fields the user
 * never explicitly touched would stay `undefined` in the DB while the UI
 * still renders the schema default — a mismatch that has caused silent
 * connection-mode regressions in the past.
 */
export function mergeBotSettingsForPersist(
  platform: string | undefined,
  settings: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (settings === undefined) return undefined;
  if (!platform) return settings;
  const definition = platformRegistry.getPlatform(platform);
  if (!definition) return settings;
  return mergeWithDefaults(definition.schema, settings);
}

/**
 * The settings to persist for a bot being created: {@link mergeBotSettingsForPersist}, with the
 * bot-wake switch on unless the caller set it. The switch's schema default stays off, because the
 * runtime merges schema defaults into bots saved before the switch existed; only a new bot starts
 * with it on.
 */
export function mergeBotSettingsForCreate(
  platform: string | undefined,
  settings: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const definition = platform ? platformRegistry.getPlatform(platform) : undefined;
  const hasWakeSwitch = definition?.schema
    .find((field) => field.key === 'settings')
    ?.properties?.some((field) => field.key === BOT_WAKE_SETTING_KEYS.enabled);
  if (!hasWakeSwitch || settings?.[BOT_WAKE_SETTING_KEYS.enabled] !== undefined) {
    return mergeBotSettingsForPersist(platform, settings);
  }

  return mergeBotSettingsForPersist(platform, {
    ...settings,
    [BOT_WAKE_SETTING_KEYS.enabled]: true,
  });
}

/**
 * The settings to persist for a partial update: the keys in `patch` over the stored settings, then
 * the schema defaults for anything still missing. The settings column is replaced whole on write,
 * so merging only `patch` with the defaults reset every key the caller did not send (the owner's
 * user id, the access lists, the bot-wake switch) to its default.
 *
 * The stored settings go through the same projection the settings form reads
 * (`flattenBotWakeSettings`): a hand-written nested `botWake` becomes the flat keys, so a flat key
 * in `patch` (`botWakeDuties`) is what the runtime reads, not shadowed by the nested object.
 *
 * Use when:
 * - A caller sends only the keys it changes (the AI `updateBot` tool), not the whole form
 *
 * Expects:
 * - `patch` is key-level: a key it carries replaces the stored value whole, arrays included
 */
export function mergeBotSettingsPatch(
  platform: string | undefined,
  existing: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return mergeBotSettingsForPersist(platform, { ...flattenBotWakeSettings(existing), ...patch });
}

/**
 * Run cross-platform access-policy invariants on settings before they hit
 * the DB. Throws a plain `Error` with field-prefixed messages so each caller
 * can re-wrap it (TRPC -> `TRPCError`, AI runtime -> tool error result).
 * Skipped when `settings` is undefined (update payload didn't touch them).
 */
export function assertBotAccessSettings(settings: Record<string, unknown> | undefined): void {
  if (settings === undefined) return;
  const result = validateAccessSettings(settings);
  if (result.valid) return;
  const message =
    result.errors?.map((e) => `${e.field}: ${e.message}`).join('; ') ||
    'Invalid access policy settings';
  throw new Error(message);
}

/**
 * Adding or changing watch keywords turns on passive channel monitoring — a
 * gated feature (`messageMonitoring`). Enforced only when the incoming
 * settings actually change the keyword set: unrelated settings saves and
 * keyword removals always pass, so existing configurations are never locked
 * out of their own record (they simply stop matching at runtime while the
 * feature isn't allowed).
 */
export async function assertWatchKeywordsWritable(params: {
  applicationId?: string;
  existingSettings?: Record<string, unknown> | null;
  platform: string;
  settings?: Record<string, unknown>;
  userId: string;
  workspaceId?: string;
}): Promise<void> {
  if (params.settings === undefined) return;
  const next = extractWatchKeywordEntries(params.settings);
  // Clearing (or never having) keywords is always allowed.
  if (next.length === 0) return;
  // Only additions/edits turn on new monitoring capability. Removals and
  // reorders of already-saved entries pass, so a downgraded plan can still
  // prune stale keywords one row at a time.
  const prev = new Set(
    extractWatchKeywordEntries(params.existingSettings ?? undefined).map((e) => JSON.stringify(e)),
  );
  if (next.every((e) => prev.has(JSON.stringify(e)))) return;

  await assertBotFeatureAccess({
    action: 'manage',
    applicationId: params.applicationId,
    feature: 'messageMonitoring',
    platform: params.platform,
    userId: params.userId,
    workspaceId: params.workspaceId,
  });
}

interface BotInvalidationTarget {
  applicationId: string;
  platform: string;
  /** Previous settings — enables capability-delta detection (e.g. watch keywords). */
  settings?: Record<string, unknown> | null;
  /** Owner of the bot — passed to `GatewayService.stopClient` for runtime teardown. */
  userId: string;
}

interface BotInvalidationDelta {
  applicationId?: string;
  enabled?: boolean;
  platform?: string;
  settings?: Record<string, unknown>;
}

/**
 * Drop the cached `RegisteredBot` so the next inbound webhook re-reads the
 * latest credentials/settings, and stop the gateway runtime when the change
 * makes the existing process invalid (disabled, app-id rebound, platform
 * changed). Both TRPC and the AI message tool call this after persisting
 * a successful update so the two write paths stay in sync.
 */
export async function invalidateBotAfterUpdate(
  existing: BotInvalidationTarget,
  value: BotInvalidationDelta,
): Promise<void> {
  const service = new GatewayService();

  // Passive-listening presence (watch keywords, or an enabled bot-wake scenario) feeds the external gateway's edge-filtering
  // capability (`messageMonitoring.enabled`), which is only sent at connect
  // time — a flip needs a runtime stop so the reconcile pass reconnects with
  // the fresh capability. Same-presence keyword edits don't need it. Scoped
  // tightly to where that reconnect actually exists:
  //  - only when the external message gateway is in use (local/Vercel
  //    runtimes have no reconcile loop, a stop there is plain downtime — and
  //    they don't consume the capability anyway);
  //  - only for non-webhook modes (reconciliation skips webhook providers;
  //    their registration refreshes capabilities on config save).
  const monitoringFlipped =
    service.useMessageGateway &&
    value.settings !== undefined &&
    existing.settings !== undefined &&
    hasPassiveListeningRule(value.settings, extractWatchKeywordEntries(value.settings).length) !==
      hasPassiveListeningRule(
        existing.settings,
        extractWatchKeywordEntries(existing.settings ?? undefined).length,
      ) &&
    resolveConnectionMode(platformRegistry.getPlatform(existing.platform), value.settings) !==
      'webhook';

  const shouldStopRuntime =
    value.enabled === false ||
    (value.applicationId !== undefined && value.applicationId !== existing.applicationId) ||
    (value.platform !== undefined && value.platform !== existing.platform) ||
    monitoringFlipped;

  if (shouldStopRuntime) {
    await service.stopClient(existing.platform, existing.applicationId, existing.userId);
  }

  await getBotMessageRouter().invalidateBot(existing.platform, existing.applicationId);
}
