import type { LobeChatDatabase } from '@lobechat/database';
import type { UserChannelPreferences, UserToolConfig } from '@lobechat/types';

import { UserModel } from '@/database/models/user';

/**
 * Read the caller's search / crawl channel preferences (ordered search providers
 * / crawler impls) from user settings.
 *
 * Read failures degrade to `undefined` (i.e. "no preference") rather than
 * throwing, so a settings hiccup never breaks search/crawl — the service then
 * falls back to the server default channel order.
 */
export const getUserChannelPreferences = async (
  serverDB: LobeChatDatabase,
  userId: string,
): Promise<UserChannelPreferences | undefined> => {
  try {
    const settings = await new UserModel(serverDB, userId).getUserSettings();
    // `userSettings.tool` is an untyped jsonb column.
    const tool = settings?.tool as UserToolConfig | undefined;
    if (!tool) return undefined;

    return { crawlerImpls: tool.crawlerImpls, searchProviders: tool.searchProviders };
  } catch (e) {
    console.error('[SearchService] failed to read user channel preferences:', (e as Error).message);
    return undefined;
  }
};
