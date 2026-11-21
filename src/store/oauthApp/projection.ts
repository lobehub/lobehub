import { defineReplica } from '@/libs/replica';
import { oauthAppService } from '@/services/oauthApp';
import { type OAuthAppItem } from '@/types/oauthApp';

/**
 * The OAuth apps of the active scope (user + workspace), keyed `all`.
 *
 * Persisted so the settings page paints the last-known rows on open and the
 * network only confirms. Responses never carry a client secret (the router
 * strips it to `hasSecret`), so the rows are safe to keep in IndexedDB.
 */
export const oauthAppListResource = defineReplica<Record<string, never>, OAuthAppItem[]>({
  fetcher: () => oauthAppService.list(),
  key: () => 'all',
  name: 'oauthAppList',
  storage: 'indexedDB',
  version: 1,
});

/** One app's page, keyed by its client id; a `null` answer means gone. */
export const oauthAppDetailResource = defineReplica<string, OAuthAppItem, OAuthAppItem | null>({
  // `null`, not `undefined`: an `undefined` answer never settles the sync as missing.
  fetcher: async (id) => (await oauthAppService.getById(id)) ?? null,
  key: (id) => id,
  name: 'oauthAppDetail',
  storage: 'indexedDB',
  version: 1,
});
