import {
  ConnectorDataError,
  type ConnectorDataProvider,
  isConnectorDataProvider,
} from '@lobechat/connector-data';
import type { GitHubConnectorClient } from '@lobechat/connector-data/github';
import { createGitHubMarketConnectorClient } from '@lobechat/connector-data/github';
import type { GmailConnectorClient } from '@lobechat/connector-data/gmail';
import { createGmailConnectorClient, hasGmailReadPermission } from '@lobechat/connector-data/gmail';
import type { NotionConnectorClient } from '@lobechat/connector-data/notion';
import { createNotionConnectorClient } from '@lobechat/connector-data/notion';
import type { TwitterConnectorClient } from '@lobechat/connector-data/twitter';
import { createTwitterMarketConnectorClient } from '@lobechat/connector-data/twitter';

import { ConnectorModel } from '@/database/models/connector';
import type { LobeChatDatabase } from '@/database/type';
import { getComposioClient, isComposioConnectedAccountLookupNotFoundError } from '@/libs/composio';
import { MarketService } from '@/server/services/market';

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
 * - Provider clients backed by Composio or LobeHub Market
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

  /**
   * Resolves the current user's LobeHub Market GitHub connection.
   *
   * Use when:
   * - A server workflow needs GitHub REST or GraphQL data without handling OAuth credentials
   *
   * Expects:
   * - Trusted Client authentication is configured for the Market service
   * - The current Market user has connected the `github` provider
   *
   * Returns:
   * - A user-scoped GitHub connector client backed by Market's OAuth proxy
   */
  getGitHubClient = async (): Promise<GitHubConnectorClient> => {
    const market = new MarketService({
      userInfo: { userId: this.userId, workspaceId: this.workspaceId },
    });
    const status = await market.market.skills.getStatus('github');
    if (!status.success || !status.connected) throw unavailable('github');

    return createGitHubMarketConnectorClient({ market });
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
