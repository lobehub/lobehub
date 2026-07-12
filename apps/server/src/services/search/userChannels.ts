import type { LobeChatDatabase } from '@lobechat/database';
import type { UserToolConfig, UserWebBrowsingConfig } from '@lobechat/types';

import { UserModel } from '@/database/models/user';

/**
 * Read the caller's web browsing channel preferences (ordered search providers
 * / crawler impls) from user settings.
 *
 * Read failures degrade to `undefined` (i.e. "no preference") rather than
 * throwing, so a settings hiccup never breaks search/crawl — the service then
 * falls back to the server default channel order.
 */
export const getUserWebBrowsingConfig = async (
  serverDB: LobeChatDatabase,
  userId: string,
): Promise<UserWebBrowsingConfig | undefined> => {
  try {
    const settings = await new UserModel(serverDB, userId).getUserSettings();
    // `userSettings.tool` is an untyped jsonb column.
    return (settings?.tool as UserToolConfig | undefined)?.webBrowsing;
  } catch (e) {
    console.error('[SearchService] failed to read user web browsing config:', (e as Error).message);
    return undefined;
  }
};
