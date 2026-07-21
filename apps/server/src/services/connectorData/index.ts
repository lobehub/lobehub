import { ConnectorDataError } from '@lobechat/connector-data';
import type { GitHubConnectorClient } from '@lobechat/connector-data/github';
import { createGitHubConnectorClient } from '@lobechat/connector-data/github';
import type { GmailConnectorClient } from '@lobechat/connector-data/gmail';
import { createGmailConnectorClient } from '@lobechat/connector-data/gmail';
import { and, eq } from 'drizzle-orm';

import { ConnectorModel } from '@/database/models/connector';
import { account } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { getComposioClient } from '@/libs/composio';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { ensureFreshConnectorToken } from '@/server/services/connector/tokens';

const TOKEN_EXPIRY_SKEW_MS = 60_000;

const unavailable = (provider: 'github' | 'gmail') =>
  new ConnectorDataError({
    code: `${provider}_authorization_unavailable`,
    operation: 'getClient',
    provider,
    retryable: false,
  });

const isActiveReference = (reference: { isEnabled: boolean; status: string }) =>
  reference.isEnabled && reference.status === 'connected';

const isTokenUsable = (expiresAt: Date | number | null | undefined) =>
  expiresAt == null ||
  (expiresAt instanceof Date ? expiresAt.getTime() : expiresAt) > Date.now() + TOKEN_EXPIRY_SKEW_MS;

export class ConnectorDataService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  getGitHubClient = async (): Promise<GitHubConnectorClient> => {
    const referenceModel = new ConnectorModel(this.db, this.userId, this.workspaceId);
    const references = (await referenceModel.queryReferencesByIdentifiers(['github']))
      .filter(isActiveReference)
      .toSorted((left, right) => left.id.localeCompare(right.id));

    if (references.length > 0) {
      try {
        const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
        const connectorModel = new ConnectorModel(
          this.db,
          this.userId,
          this.workspaceId,
          gateKeeper,
        );
        for (const reference of references) {
          const connector = await connectorModel.findById(reference.id);
          if (!connector || connector.identifier !== 'github' || !isActiveReference(connector)) {
            continue;
          }
          const fresh = await ensureFreshConnectorToken(connector, connectorModel);
          const credentials = fresh.credentials;
          if (
            credentials?.type === 'oauth2' &&
            typeof credentials.accessToken === 'string' &&
            credentials.accessToken.length > 0 &&
            isTokenUsable(credentials.expiresAt ?? fresh.tokenExpiresAt)
          ) {
            return createGitHubConnectorClient({ accessToken: credentials.accessToken });
          }
        }
      } catch {
        // A connector that cannot be decrypted is unusable; personal OAuth remains a valid fallback.
      }
    }

    const accounts = await this.db
      .select({
        accessToken: account.accessToken,
        accessTokenExpiresAt: account.accessTokenExpiresAt,
        id: account.id,
      })
      .from(account)
      .where(and(eq(account.userId, this.userId), eq(account.providerId, 'github')))
      .orderBy(account.id)
      .limit(16);
    const authAccount = accounts.find(
      ({ accessToken, accessTokenExpiresAt }) =>
        typeof accessToken === 'string' &&
        accessToken.length > 0 &&
        isTokenUsable(accessTokenExpiresAt),
    );
    if (authAccount?.accessToken) {
      return createGitHubConnectorClient({ accessToken: authAccount.accessToken });
    }
    throw unavailable('github');
  };

  getGmailClient = async (): Promise<GmailConnectorClient> => {
    const connectorModel = new ConnectorModel(this.db, this.userId, this.workspaceId);
    const references = (await connectorModel.queryComposioReferencesByIdentifiers(['gmail']))
      .filter(
        (reference) =>
          isActiveReference(reference) &&
          reference.composio?.appSlug.slice(0, 32).toLowerCase() === 'gmail' &&
          reference.composio.status.slice(0, 32).toUpperCase() === 'ACTIVE' &&
          reference.composio.connectedAccountId.length > 0 &&
          reference.composio.connectedAccountId.length <= 512 &&
          reference.composio.ownerUserId.length > 0 &&
          reference.composio.ownerUserId.length <= 512,
      )
      .toSorted((left, right) => left.id.localeCompare(right.id));

    for (const reference of references) {
      const composio = reference.composio;
      if (!composio) continue;
      try {
        const client = createGmailConnectorClient({
          composio: getComposioClient(),
          connectedAccountId: composio.connectedAccountId,
          userId: composio.ownerUserId,
        });
        await client.getAccount();
        return client;
      } catch (error) {
        if (error instanceof ConnectorDataError && error.retryable) throw error;
      }
    }
    throw unavailable('gmail');
  };
}
