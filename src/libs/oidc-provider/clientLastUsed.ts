import { type LobeChatDatabase } from '@lobechat/database';
import { oidcClients } from '@lobechat/database/schemas';
import debug from 'debug';
import { eq } from 'drizzle-orm';

const log = debug('lobe-oidc:client-last-used');

/** Static first-party clients have no row to stamp. */
const USER_OWNED_CLIENT_PREFIXES = ['lca_', 'lcd_'];

/**
 * Record that a user-owned OAuth client — created on the settings page (`lca_`)
 * or through dynamic registration (`lcd_`) — was just issued a token.
 *
 * `last_used_at` is a best-effort UX signal on the OAuth Apps page; a failed
 * stamp must never break token issuance, so the update is not awaited and all
 * errors are swallowed.
 */
export const stampClientLastUsed = (db: LobeChatDatabase, clientId?: string): void => {
  if (!clientId || !USER_OWNED_CLIENT_PREFIXES.some((prefix) => clientId.startsWith(prefix)))
    return;

  void db
    .update(oidcClients)
    .set({ lastUsedAt: new Date() })
    .where(eq(oidcClients.id, clientId))
    .then(undefined, (error: unknown) => {
      log('Failed to stamp last_used_at for client %s: %O', clientId, error);
    });
};
