import {
  ConnectorDataError,
  type ConnectorDataProvider,
  isConnectorDataProvider,
} from '@lobechat/connector-data';
import type { GitHubConnectorClient } from '@lobechat/connector-data/github';
import {
  createGitHubComposioConnectorClient,
  createGitHubOAuthConnectorClient,
} from '@lobechat/connector-data/github';
import type { GmailConnectorClient } from '@lobechat/connector-data/gmail';
import { createGmailConnectorClient, hasGmailReadPermission } from '@lobechat/connector-data/gmail';
import type { NotionConnectorClient } from '@lobechat/connector-data/notion';
import { createNotionConnectorClient } from '@lobechat/connector-data/notion';
import type { TwitterConnectorClient } from '@lobechat/connector-data/twitter';
import { createTwitterMarketConnectorClient } from '@lobechat/connector-data/twitter';
import { and, eq } from 'drizzle-orm';

import { ConnectorModel } from '@/database/models/connector';
import { account } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { getComposioClient, isComposioConnectedAccountLookupNotFoundError } from '@/libs/composio';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { ensureFreshConnectorToken } from '@/server/services/connector/tokens';
import { MarketService } from '@/server/services/market';

const TOKEN_EXPIRY_SKEW_MS = 60_000;

const unavailable = (provider: ConnectorDataProvider) =>
  new ConnectorDataError({
    code: `${provider}_authorization_unavailable`,
    operation: 'getClient',
    provider,
    retryable: false,
  });

const isConfirmedProviderUnavailableError = (error: unknown, provider: ConnectorDataProvider) =>
  error instanceof ConnectorDataError &&
  error.provider === provider &&
  !error.retryable &&
  (error.code === `${provider}_authorization_unavailable` ||
    error.code === `${provider}_account_unavailable`);

const isActiveReference = (reference: { isEnabled: boolean; status: string }) =>
  reference.isEnabled && reference.status === 'connected';

const isActiveComposioReference = (
  reference: {
    composio?: {
      appSlug: string;
      connectedAccountId: string;
      ownerUserId: string;
      status: string;
    };
    isEnabled: boolean;
    status: string;
  },
  provider: ConnectorDataProvider,
) =>
  isActiveReference(reference) &&
  reference.composio?.appSlug.slice(0, 32).toLowerCase() === provider &&
  reference.composio.status.slice(0, 32).toUpperCase() === 'ACTIVE' &&
  reference.composio.connectedAccountId.length > 0 &&
  reference.composio.connectedAccountId.length <= 512 &&
  reference.composio.ownerUserId.length > 0 &&
  reference.composio.ownerUserId.length <= 512;

const isTokenUsable = (expiresAt: Date | number | null | undefined) =>
  expiresAt == null ||
  (expiresAt instanceof Date ? expiresAt.getTime() : expiresAt) > Date.now() + TOKEN_EXPIRY_SKEW_MS;

/**
 * Resolves authenticated connector-data clients for one user and workspace scope.
 *
 * Use when:
 * - A server workflow needs provider data without handling credential storage
 * - Provider availability must reflect persisted connector health
 *
 * Expects:
 * - The database and user scope come from an authenticated server context
 *
 * Returns:
 * - Provider clients backed by Composio, LobeHub Market, connector OAuth, or account fallback
 */
export class ConnectorDataService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private resolveProviderClient = (providerId: ConnectorDataProvider): Promise<unknown> => {
    const resolvers: Record<ConnectorDataProvider, () => Promise<unknown>> = {
      github: () => this.getGitHubClient(),
      gmail: () => this.getGmailClient(),
      notion: () => this.getNotionClient(),
      twitter: () => this.getTwitterClient(),
    };
    return resolvers[providerId]();
  };

  /**
   * Lists provider identifiers with a connector client that can be resolved now.
   *
   * Use when:
   * - A workflow must exclude disconnected or remotely deleted sources before initialization
   *
   * Expects:
   * - Provider identifiers supported by Connector Data
   *
   * Returns:
   * - Available identifiers in the caller's original order
   */
  listAvailableProviderIds = async (providerIds: readonly string[]): Promise<string[]> => {
    const availability = await Promise.all(
      providerIds.map(async (providerId) => {
        if (!isConnectorDataProvider(providerId)) return;

        try {
          const client = await this.resolveProviderClient(providerId);
          if (providerId === 'gmail') {
            const account = await (client as GmailConnectorClient).getAccount();
            if (!hasGmailReadPermission(account.scopes)) return;
          }
          return providerId;
        } catch (error) {
          if (isConfirmedProviderUnavailableError(error, providerId)) return;
          throw error;
        }
      }),
    );
    return availability.filter(
      (providerId): providerId is ConnectorDataProvider => providerId !== undefined,
    );
  };

  getGitHubClient = async (): Promise<GitHubConnectorClient> => {
    const referenceModel = new ConnectorModel(this.db, this.userId, this.workspaceId);

    const composioReferences = (
      await referenceModel.queryComposioReferencesByIdentifiers(['github'])
    )
      .filter((reference) => isActiveComposioReference(reference, 'github'))
      .toSorted((left, right) => left.id.localeCompare(right.id));
    for (const reference of composioReferences) {
      const metadata = reference.composio;
      if (!metadata) continue;
      try {
        const composio = getComposioClient();
        const connectedAccount = await composio.connectedAccounts.get(metadata.connectedAccountId);
        if (connectedAccount.status !== 'ACTIVE') continue;
        return createGitHubComposioConnectorClient({
          composio,
          connectedAccountId: metadata.connectedAccountId,
        });
      } catch (error) {
        if (!isComposioConnectedAccountLookupNotFoundError(error)) throw error;
        await referenceModel.markComposioConnectionUnavailable(
          reference.id,
          metadata.connectedAccountId,
        );
      }
    }

    const references = (await referenceModel.queryReferencesByIdentifiers(['github']))
      .filter(isActiveReference)
      .toSorted((left, right) => left.id.localeCompare(right.id));

    if (references.length > 0) {
      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
      const connectorModel = new ConnectorModel(this.db, this.userId, this.workspaceId, gateKeeper);
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
          return createGitHubOAuthConnectorClient({ accessToken: credentials.accessToken });
        }
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
      return createGitHubOAuthConnectorClient({ accessToken: authAccount.accessToken });
    }
    throw unavailable('github');
  };

  getGmailClient = async (): Promise<GmailConnectorClient> => {
    const connectorModel = new ConnectorModel(this.db, this.userId, this.workspaceId);
    const references = (await connectorModel.queryComposioReferencesByIdentifiers(['gmail']))
      .filter((reference) => isActiveComposioReference(reference, 'gmail'))
      .toSorted((left, right) => left.id.localeCompare(right.id));

    for (const reference of references) {
      const composio = reference.composio;
      if (!composio) continue;
      try {
        const composioClient = getComposioClient();
        await composioClient.connectedAccounts.get(composio.connectedAccountId);
        const client = createGmailConnectorClient({
          composio: composioClient,
          connectedAccountId: composio.connectedAccountId,
          userId: composio.ownerUserId,
        });
        await client.getAccount();
        return client;
      } catch (error) {
        if (isComposioConnectedAccountLookupNotFoundError(error)) {
          await connectorModel.markComposioConnectionUnavailable(
            reference.id,
            composio.connectedAccountId,
          );
          continue;
        }
        if (
          error instanceof ConnectorDataError &&
          error.provider === 'gmail' &&
          error.code === 'gmail_account_unavailable' &&
          !error.retryable
        ) {
          continue;
        }
        throw error;
      }
    }
    throw unavailable('gmail');
  };

  /**
   * Resolves the first active Notion Composio account for this user scope.
   *
   * Use when:
   * - An onboarding collector needs read-only Notion workspace evidence
   *
   * Expects:
   * - A connected Notion reference whose remote Composio account remains ACTIVE
   *
   * Returns:
   * - A user-scoped Notion connector client
   */
  getNotionClient = async (): Promise<NotionConnectorClient> => {
    const connectorModel = new ConnectorModel(this.db, this.userId, this.workspaceId);
    const references = (await connectorModel.queryComposioReferencesByIdentifiers(['notion']))
      .filter((reference) => isActiveComposioReference(reference, 'notion'))
      .toSorted((left, right) => left.id.localeCompare(right.id));

    for (const reference of references) {
      const composio = reference.composio;
      if (!composio) continue;
      try {
        const composioClient = getComposioClient();
        const connectedAccount = await composioClient.connectedAccounts.get(
          composio.connectedAccountId,
        );
        if (connectedAccount.status !== 'ACTIVE') continue;
        return createNotionConnectorClient({
          composio: composioClient,
          connectedAccountId: composio.connectedAccountId,
          userId: composio.ownerUserId,
        });
      } catch (error) {
        if (!isComposioConnectedAccountLookupNotFoundError(error)) throw error;
        await connectorModel.markComposioConnectionUnavailable(
          reference.id,
          composio.connectedAccountId,
        );
      }
    }
    throw unavailable('notion');
  };

  /**
   * Resolves the current user's LobeHub Market X connection.
   *
   * Use when:
   * - An onboarding collector needs read-only public X profile and recent-post evidence
   *
   * Expects:
   * - Trusted Client authentication is configured for the Market service
   * - The current Market user has connected the `twitter` provider
   *
   * Returns:
   * - A user-scoped X connector client backed by Market skill tools
   */
  getTwitterClient = async (): Promise<TwitterConnectorClient> => {
    const market = new MarketService({
      userInfo: { userId: this.userId, workspaceId: this.workspaceId },
    }).market;
    const status = await market.skills.getStatus('twitter');
    if (!status.success || !status.connected) throw unavailable('twitter');

    return createTwitterMarketConnectorClient({
      market: {
        callTool: async (toolName, arguments_) => {
          const response = await market.skills.callTool('twitter', {
            args: arguments_,
            tool: toolName,
          });
          return { data: response.data, success: response.success };
        },
      },
    });
  };
}
