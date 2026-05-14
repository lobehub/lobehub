import debug from 'debug';

import { getMessengerDiscordConfig } from '@/config/messenger';

import type { InstallationCredentials, MessengerInstallationStore } from './types';

const log = debug('lobe-server:messenger:install-store:discord');

/**
 * Discord uses a single App-level bot token that works across every guild
 * the bot is installed into — there is no per-tenant token exchange like
 * Slack's OAuth. So "tenant" is meaningless here, the same shape as Telegram.
 */
export const DISCORD_INSTALLATION_KEY = 'discord:singleton';

const buildCreds = async (): Promise<InstallationCredentials | null> => {
  const config = await getMessengerDiscordConfig();
  if (!config) return null;
  return {
    accountId: config.applicationId,
    applicationId: config.applicationId,
    botToken: config.botToken,
    installationKey: DISCORD_INSTALLATION_KEY,
    metadata: {
      publicKey: config.publicKey,
    },
    platform: 'discord',
    tenantId: '',
  };
};

export class DiscordInstallationStore implements MessengerInstallationStore {
  async resolveByPayload(): Promise<InstallationCredentials | null> {
    const creds = await buildCreds();
    if (!creds) log('resolveByPayload: discord credentials not configured in DB');
    return creds;
  }

  async resolveByKey(installationKey: string): Promise<InstallationCredentials | null> {
    if (installationKey !== DISCORD_INSTALLATION_KEY) return null;
    return buildCreds();
  }
}
