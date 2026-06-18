import { GatewayService } from '@/server/services/gateway';

import { getBotMessageRouter } from './BotMessageRouter';
import { mergeWithDefaults, platformRegistry, validateAccessSettings } from './platforms';

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

interface BotInvalidationTarget {
  applicationId: string;
  platform: string;
  /** Owner of the bot — passed to `GatewayService.stopClient` for runtime teardown. */
  userId: string;
}

interface BotInvalidationDelta {
  applicationId?: string;
  enabled?: boolean;
  platform?: string;
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
  const shouldStopRuntime =
    value.enabled === false ||
    (value.applicationId !== undefined && value.applicationId !== existing.applicationId) ||
    (value.platform !== undefined && value.platform !== existing.platform);

  if (shouldStopRuntime) {
    const service = new GatewayService();
    await service.stopClient(existing.platform, existing.applicationId, existing.userId);
  }

  await getBotMessageRouter().invalidateBot(existing.platform, existing.applicationId);
}
