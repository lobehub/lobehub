import { McpOauthModel } from '@/database/models/mcpOauth';
import type { LobeChatDatabase } from '@/database/type';

import { refreshTokens } from './refresh';

const REAUTH_REQUIRED = 'REAUTH_REQUIRED';

/**
 * Resolve OAuth access token for MCP (userId, pluginIdentifier).
 * If expired, attempt one refresh; on invalid_grant delete tokens and throw REAUTH_REQUIRED.
 * Returns auth config for MCP client: { type: 'oauth2', accessToken }.
 */
export async function resolveMcpOAuthToken(
  serverDB: LobeChatDatabase,
  userId: string,
  pluginIdentifier: string,
): Promise<{ accessToken: string; type: 'oauth2' }> {
  const model = new McpOauthModel(serverDB);
  const row = await model.findTokens(userId, pluginIdentifier);
  if (!row) {
    const err = new Error(REAUTH_REQUIRED);
    (err as any).code = REAUTH_REQUIRED;
    throw err;
  }

  let accessToken = row.accessToken;
  let refreshToken = row.refreshToken;
  let expiresAt = row.expiresAt;
  const tokenEndpoint = row.tokenEndpoint;
  const clientId = row.clientId;

  const now = new Date();
  const bufferMs = 60 * 1000; // 1 min buffer
  const needsRefresh = expiresAt && new Date(expiresAt.getTime() - bufferMs) <= now;

  if (needsRefresh && refreshToken) {
    try {
      const tokens = await refreshTokens({
        clientId,
        refreshToken,
        tokenEndpoint,
      });
      accessToken = tokens.access_token;
      const newExpiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null;
      await model.upsertTokens({
        accessToken: tokens.access_token,
        clientId,
        expiresAt: newExpiresAt,
        pluginIdentifier,
        refreshToken: tokens.refresh_token ?? refreshToken,
        tokenEndpoint,
        userId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'invalid_grant') {
        await model.deleteTokens(userId, pluginIdentifier);
        const err = new Error(REAUTH_REQUIRED);
        (err as any).code = REAUTH_REQUIRED;
        throw err;
      }
      throw error;
    }
  }

  return { accessToken, type: 'oauth2' };
}

export { REAUTH_REQUIRED };
