import { type LobeChatDatabase } from '@lobechat/database';
import { type UserGeneralConfig } from '@lobechat/types';

import { UserModel } from '@/database/models/user';
import { appEnv } from '@/envs/app';

import { trpc } from '../init';

export interface TelemetryContext {
  serverDB?: LobeChatDatabase;
  userId?: string | null;
}

export interface TelemetryResult {
  telemetryEnabled: boolean;
}

/**
 * Check if telemetry is enabled for the current user
 *
 * Priority:
 * 1. Environment variable TELEMETRY_DISABLED=1 → telemetryEnabled: false (highest priority)
 * 2. User settings from database user_settings.general.telemetry (new location)
 * 3. User preference from database users.preference.telemetry (old location, deprecated)
 * 4. Default to true if not explicitly set
 */
export const checkTelemetryEnabled = async (ctx: TelemetryContext): Promise<TelemetryResult> => {
  // Priority 1: Check environment variable (highest priority)
  if (appEnv.TELEMETRY_DISABLED) {
    return { telemetryEnabled: false };
  }

  // If userId or serverDB is not available, default to disabled
  if (!ctx.userId || !ctx.serverDB) {
    return { telemetryEnabled: false };
  }

  try {
    const userModel = new UserModel(ctx.serverDB, ctx.userId);

    // Priority 2: Check user settings (new location: settings.general.telemetry)
    const settings = await userModel.getUserSettings();
    const generalConfig = settings?.general as UserGeneralConfig | null | undefined;

    if (generalConfig?.telemetry === false) {
      return { telemetryEnabled: false };
    }

    // Priority 3: Check user preference (old location: preference.telemetry)
    const preference = await userModel.getUserPreference();

    if (typeof preference?.telemetry === 'boolean') {
      return { telemetryEnabled: preference?.telemetry };
    }

    // Priority 4: Default to true if not explicitly set
    return { telemetryEnabled: true };
  } catch {
    // If fetching user settings fails, default to disabled
    return { telemetryEnabled: false };
  }
};

/**
 * Middleware that checks if telemetry is enabled for the current user
 * and adds telemetryEnabled to the context
 *
 * Requires serverDatabase middleware to be applied first
 */
export const telemetry = trpc.middleware(async (opts) => {
  const result = await checkTelemetryEnabled(opts.ctx as TelemetryContext);

  return opts.next({ ctx: result });
});
