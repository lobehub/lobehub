import debug from 'debug';

import { getMessengerTelegramConfig } from '@/config/messenger';

import type { InstallationCredentials, MessengerInstallationStore } from './types';

const log = debug('lobe-server:messenger:install-store:telegram');

/**
 * Telegram bots are global — one bot token in env serves every chat — so
 * "tenant" is meaningless. Returns a single env-backed credential bundle
 * regardless of the inbound payload.
 */
export const TELEGRAM_INSTALLATION_KEY = 'telegram:singleton';

const buildCreds = async (): Promise<InstallationCredentials | null> => {
  const config = await getMessengerTelegramConfig();
  if (!config) return null;
  return {
    accountId: undefined,
    // Telegram's "application id" is just the bot token's prefix; we use the
    // installation key as a stable opaque identifier instead.
    applicationId: TELEGRAM_INSTALLATION_KEY,
    botToken: config.botToken,
    installationKey: TELEGRAM_INSTALLATION_KEY,
    metadata: {
      botUsername: config.botUsername ?? '',
      webhookSecret: config.webhookSecret ?? '',
    },
    platform: 'telegram',
    tenantId: '',
  };
};

export class TelegramInstallationStore implements MessengerInstallationStore {
  async resolveByPayload(): Promise<InstallationCredentials | null> {
    const creds = await buildCreds();
    if (!creds) log('resolveByPayload: telegram credentials not configured in DB');
    return creds;
  }

  async resolveByKey(installationKey: string): Promise<InstallationCredentials | null> {
    if (installationKey !== TELEGRAM_INSTALLATION_KEY) return null;
    return buildCreds();
  }
}
