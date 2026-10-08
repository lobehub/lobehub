import debug from 'debug';

import { getMessengerLinqConfig } from '@/config/messenger';

import type { InstallationCredentials, MessengerInstallationStore } from './types';

const log = debug('lobe-server:messenger:install-store:linq');

/**
 * The Linq pool is one deployment-level install: the same API key serves every
 * pool number and every sender, so — like Telegram — there is no tenant.
 * Routing happens per sender in `messenger_account_links`, not per install.
 */
export const LINQ_INSTALLATION_KEY = 'linq:singleton';

const buildCreds = async (): Promise<InstallationCredentials | null> => {
  const config = await getMessengerLinqConfig();
  if (!config) return null;
  return {
    applicationId: LINQ_INSTALLATION_KEY,
    botToken: config.apiKey,
    installationKey: LINQ_INSTALLATION_KEY,
    metadata: { poolSize: config.numbers.length },
    platform: 'linq',
    tenantId: '',
  };
};

export class LinqInstallationStore implements MessengerInstallationStore {
  async resolveByPayload(): Promise<InstallationCredentials | null> {
    const creds = await buildCreds();
    if (!creds) log('resolveByPayload: linq credentials not configured');
    return creds;
  }

  async resolveByKey(installationKey: string): Promise<InstallationCredentials | null> {
    if (installationKey !== LINQ_INSTALLATION_KEY) return null;
    return buildCreds();
  }
}
