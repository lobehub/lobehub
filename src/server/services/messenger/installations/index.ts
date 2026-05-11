import type { MessengerPlatform } from '@/config/messenger';

import { DiscordInstallationStore } from './discord';
import { SlackInstallationStore } from './slack';
import { TelegramInstallationStore } from './telegram';
import type { MessengerInstallationStore } from './types';

/**
 * One InstallationStore singleton per platform — they're stateless apart
 * from the in-process refresh single-flight cache (Slack), so a single
 * instance per process is correct.
 */
const stores: Partial<Record<MessengerPlatform, MessengerInstallationStore>> = {};

const create = (platform: MessengerPlatform): MessengerInstallationStore | null => {
  switch (platform) {
    case 'slack': {
      return new SlackInstallationStore();
    }
    case 'telegram': {
      return new TelegramInstallationStore();
    }
    case 'discord': {
      return new DiscordInstallationStore();
    }
    default: {
      return null;
    }
  }
};

export const getInstallationStore = (
  platform: MessengerPlatform,
): MessengerInstallationStore | null => {
  if (!stores[platform]) {
    const store = create(platform);
    if (!store) return null;
    stores[platform] = store;
  }
  return stores[platform] ?? null;
};

/**
 * Build the per-user gateway connection id for a messenger run.
 *
 * Sharding the gateway DO by `(platform, lobeUserId)` instead of by install
 * gives each user their own DO — required so concurrent typing across
 * multiple chats from the same install no longer overwrite a shared
 * `TypingState` and so 200K-MAU load doesn't pile onto one DO.
 *
 * - Telegram / Discord: `messenger:<platform>:user-<userId>` (no tenant —
 *   global bot token shared by every user DO).
 * - Slack: `messenger:slack:<tenantId>:user-<userId>` — tenant retained
 *   because the same `lobeUserId` may link multiple workspaces, each with
 *   its own rotating OAuth token.
 *
 * Single source of truth: derives directly from the `installationKey`
 * shape (`<platform>:<tenantId>` or `<platform>:singleton`) so callers
 * never branch on platform name themselves.
 */
export const messengerConnectionIdForUser = (params: {
  installationKey: string;
  userId: string;
}): string => {
  const { installationKey, userId } = params;
  const SINGLETON_SUFFIX = ':singleton';
  if (installationKey.endsWith(SINGLETON_SUFFIX)) {
    const platform = installationKey.slice(0, -SINGLETON_SUFFIX.length);
    return `messenger:${platform}:user-${userId}`;
  }
  return `messenger:${installationKey}:user-${userId}`;
};

export { DISCORD_INSTALLATION_KEY, DiscordInstallationStore } from './discord';
export { SlackInstallationStore } from './slack';
export { TELEGRAM_INSTALLATION_KEY, TelegramInstallationStore } from './telegram';
export type { InstallationCredentials, MessengerInstallationStore } from './types';
