import debug from 'debug';
import { eq } from 'drizzle-orm';

import { assertBotFeatureAccess } from '@/business/server/bot/featureAccess';
import { agents } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  BOT_WAKE_SETTING_KEYS,
  flattenBotWakeSettings,
  hasPassiveListeningRule,
} from '@/server/services/conversationWake/config';
import { GatewayService } from '@/server/services/gateway';
import { isMessageGatewayHostingUnavailable } from '@/server/services/gateway/nodeGatewayOnly';
import { resolveReplyConnectionHost } from '@/server/services/gateway/replyConnectionHost';

import { getBotMessageRouter } from './BotMessageRouter';
import {
  extractWatchKeywordEntries,
  mergeWithDefaults,
  NEW_BOT_REACTION_MODE,
  platformRegistry,
  resolveConnectionMode,
  validateAccessSettings,
} from './platforms';

const log = debug('lobe-server:bot:provider-settings');

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

const REACTION_MODE_KEY = 'reactionMode';

/**
 * {@link mergeBotSettingsForPersist} for a bot being created, with status reactions off unless the
 * caller chose a mode. Omitted settings would persist as `{}`, where an absent mode reads as the
 * schema default (on), so on a platform that offers reactions the defaults are written instead.
 */
function withNewBotReactionMode(
  platform: string | undefined,
  settings: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const merged = mergeBotSettingsForPersist(platform, settings);
  if (settings?.[REACTION_MODE_KEY] !== undefined) return merged;
  const withDefaults = merged ?? mergeBotSettingsForPersist(platform, {});
  if (!withDefaults || !(REACTION_MODE_KEY in withDefaults)) return merged;

  return { ...withDefaults, [REACTION_MODE_KEY]: NEW_BOT_REACTION_MODE };
}

const CONNECTION_MODE_KEY = 'connectionMode';

/**
 * Webhook mode for a new bot on a platform the external message gateway cannot host, when the
 * gateway is on and the caller did not pick a mode. The settings form gets the same default from
 * `restrictPlatformToWebhook`; this covers callers that skip the form (the Message tool), whose
 * schema-default persistent mode would otherwise be refused on connect.
 */
function withGatewayConnectionMode(
  platform: string | undefined,
  requested: Record<string, unknown> | undefined,
  merged: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!platform || requested?.[CONNECTION_MODE_KEY] !== undefined) return merged;
  if (!isMessageGatewayHostingUnavailable(platformRegistry.getPlatform(platform))) return merged;
  if (!new GatewayService().useMessageGateway) return merged;

  return {
    ...(merged ?? mergeBotSettingsForPersist(platform, {})),
    [CONNECTION_MODE_KEY]: 'webhook',
  };
}

/**
 * The settings to persist for a bot being created: {@link mergeBotSettingsForPersist}, with
 * - webhook mode when the external message gateway is on and cannot host the platform's
 *   persistent connection ({@link withGatewayConnectionMode}), unless the caller chose a mode.
 * - status reactions off ({@link NEW_BOT_REACTION_MODE}) when the platform offers them and the
 *   caller did not choose. The schema default stays on, since it is also what a bot saved before
 *   the field existed reads as; only a new bot starts quiet.
 * - bot wake switched off when the agent runs on a heterogeneous runtime (Claude Code, Codex) and
 *   the caller did not choose. Every other bot speaks up on its own by default; a heterogeneous
 *   agent runs on its owner's device and their CLI quota, so it joins conversations only once the
 *   owner turns it on.
 */
export async function mergeBotSettingsForCreate(
  db: LobeChatDatabase,
  agentId: string,
  platform: string | undefined,
  settings: Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | undefined> {
  const merged = withGatewayConnectionMode(
    platform,
    settings,
    withNewBotReactionMode(platform, settings),
  );
  const key = BOT_WAKE_SETTING_KEYS.disabled;
  if (settings?.[key] !== undefined) return merged;
  // Omitted settings persist as `{}`, where an absent switch reads as on: the defaults are written
  // so the switch can be set.
  const withDefaults = merged ?? mergeBotSettingsForPersist(platform, {});
  if (!withDefaults || !(key in withDefaults)) return merged;

  const agent = await db.query.agents.findFirst({
    columns: { agencyConfig: true },
    where: eq(agents.id, agentId),
  });
  if (!agent?.agencyConfig?.heterogeneousProvider) return merged;

  return { ...withDefaults, [key]: true };
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
  /**
   * Previous decrypted credentials. Lets an in-process connection restart only when they
   * really changed: a full save resends the stored (unmasked) values unchanged.
   */
  credentials?: Record<string, unknown> | null;
  platform: string;
  /** Previous settings — enables capability-delta detection (e.g. watch keywords). */
  settings?: Record<string, unknown> | null;
  /** Owner of the bot — passed to `GatewayService.stopClient` for runtime teardown. */
  userId: string;
}

interface BotInvalidationDelta {
  applicationId?: string;
  credentials?: Record<string, unknown>;
  enabled?: boolean;
  platform?: string;
  settings?: Record<string, unknown>;
}

const haveCredentialsChanged = (
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
): boolean => {
  // Without the previous values, assume a change: a missed restart drops every message.
  if (!previous) return true;
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    if ((previous[key] ?? '') !== (next[key] ?? '')) return true;
  }
  return false;
};

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

  // A platform that replies over its own connection signs what it forwards with its credentials,
  // and the reloaded webhook adapter now verifies with the new ones: restart the connection on
  // them, or every inbound message is refused from here on.
  const replyHost =
    platformRegistry.getPlatform(existing.platform)?.repliesOverConnection &&
    resolveReplyConnectionHost(existing.platform);
  if (
    replyHost &&
    !shouldStopRuntime &&
    value.credentials !== undefined &&
    haveCredentialsChanged(existing.credentials, value.credentials)
  ) {
    const restart = service
      .startClient(existing.platform, existing.applicationId, existing.userId)
      .catch((error) => {
        log('Restart after credential change failed for %s: %O', existing.platform, error);
      });
    // In-process, the subscribe handshake can take up to its connect timeout and the save has
    // already succeeded, so it is not awaited; the client records the outcome in its runtime
    // status. A gateway connect returns at once, and on serverless a promise left running after
    // the response may never finish.
    if (replyHost === 'message-gateway') await restart;
  }
}
