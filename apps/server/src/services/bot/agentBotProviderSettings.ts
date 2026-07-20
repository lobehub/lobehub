import { assertBotFeatureAccess } from '@/business/server/bot/featureAccess';
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

  // Watch-keyword presence feeds the external gateway's edge-filtering
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
    extractWatchKeywordEntries(value.settings).length > 0 !==
      extractWatchKeywordEntries(existing.settings ?? undefined).length > 0 &&
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
