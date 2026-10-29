import type { FavoriteItem } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

/** One list per cache scope: the replica scope already carries user and workspace. */
export const FAVORITE_LIST_KEY = 'list';

/**
 * The member's sidebar favorites. The persisted copy paints the section on a
 * cold start instead of popping it in after the request answers.
 */
export const favoriteListResource = defineReplica<Record<string, never>, FavoriteItem[]>({
  key: () => FAVORITE_LIST_KEY,
  name: 'favoriteList',
  storage: 'indexedDB',
  version: 1,
});
