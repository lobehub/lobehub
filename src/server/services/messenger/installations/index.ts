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

export { DISCORD_INSTALLATION_KEY, DiscordInstallationStore } from './discord';
export { SlackInstallationStore } from './slack';
export { TELEGRAM_INSTALLATION_KEY, TelegramInstallationStore } from './telegram';
export type { InstallationCredentials, MessengerInstallationStore } from './types';
