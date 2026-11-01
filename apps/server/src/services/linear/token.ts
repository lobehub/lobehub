import { LinearConnectionModel } from '@/database/models/linear';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { refreshLinearToken } from './client';

/** Refresh this long before the recorded expiry so a call never races it. */
const EXPIRY_MARGIN_MS = 60_000;

/** The connection is revoked or its token can no longer be refreshed; the user must reconnect. */
export class LinearReconnectRequiredError extends Error {
  constructor() {
    super('Linear connection needs to be reconnected');
    this.name = 'LinearReconnectRequiredError';
  }
}

/**
 * A usable access token for a connection, refreshing (and storing) it first
 * when it is about to expire.
 */
export const getLinearAccessToken = async (
  db: LobeChatDatabase,
  connectionId: string,
): Promise<string> => {
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const connection = await LinearConnectionModel.findDecryptedById(db, connectionId, gateKeeper);
  if (!connection || connection.revokedAt || !connection.credentials) {
    throw new LinearReconnectRequiredError();
  }

  const { credentials, tokenExpiresAt } = connection;
  const expiring = !!tokenExpiresAt && tokenExpiresAt.getTime() - EXPIRY_MARGIN_MS <= Date.now();
  if (!expiring) return credentials.accessToken;
  if (!credentials.refreshToken) throw new LinearReconnectRequiredError();

  let refreshed;
  try {
    refreshed = await refreshLinearToken(credentials.refreshToken);
  } catch {
    throw new LinearReconnectRequiredError();
  }

  await LinearConnectionModel.updateCredentials(
    db,
    connectionId,
    {
      credentials: {
        accessToken: refreshed.accessToken,
        // Linear may rotate the refresh token; keep the old one when it does not.
        refreshToken: refreshed.refreshToken ?? credentials.refreshToken,
      },
      tokenExpiresAt: refreshed.expiresAt ?? null,
    },
    gateKeeper,
  );
  return refreshed.accessToken;
};
