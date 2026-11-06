import { type LobeChatDatabase } from '@lobechat/database';
import { oidcClients } from '@lobechat/database/schemas';
import debug from 'debug';
import { eq } from 'drizzle-orm';

const log = debug('lobe-oidc:client-last-used');

/**
 * Record that a user-created OAuth client (`lca_` id) was just issued a token.
 *
 * `last_used_at` is a best-effort UX signal on the OAuth Apps page; a failed
 * stamp must never break token issuance, so the update is not awaited and all
 * errors are swallowed.
 */
export const stampClientLastUsed = (db: LobeChatDatabase, clientId?: string): void => {
  if (!clientId || !clientId.startsWith('lca_')) return;

  void db
    .update(oidcClients)
    .set({ lastUsedAt: new Date() })
    .where(eq(oidcClients.id, clientId))
    .then(undefined, (error: unknown) => {
      log('Failed to stamp last_used_at for client %s: %O', clientId, error);
    });
};
