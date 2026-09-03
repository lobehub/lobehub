import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { ConnectorDataService } from './index';

const mocks = vi.hoisted(() => ({
  composioConnectedAccountGet: vi.fn(),
  createGitHubMarketClient: vi.fn(),
  createGmailClient: vi.fn(),
  createNotionClient: vi.fn(),
  createTwitterClient: vi.fn(),
  getAccount: vi.fn(),
  getComposioClient: vi.fn(),
  isComposioLookupNotFound: vi.fn(),
  markComposioUnavailable: vi.fn(),
  marketCallTool: vi.fn(),
  marketGetStatus: vi.fn(),
  marketProxyOAuthRequest: vi.fn(),
  queryComposioReferences: vi.fn(),
}));

vi.mock('@lobechat/connector-data/github', () => ({
  createGitHubMarketConnectorClient: mocks.createGitHubMarketClient,
}));

vi.mock('@lobechat/connector-data/gmail', () => ({
  createGmailConnectorClient: mocks.createGmailClient,
  hasGmailReadPermission: (scopes: readonly string[]) =>
    scopes.some((scope) => scope.endsWith('gmail.readonly')),
}));

vi.mock('@lobechat/connector-data/notion', () => ({
  createNotionConnectorClient: mocks.createNotionClient,
}));

vi.mock('@lobechat/connector-data/twitter', () => ({
  createTwitterMarketConnectorClient: mocks.createTwitterClient,
}));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn(() => ({
    markComposioConnectionUnavailable: mocks.markComposioUnavailable,
    queryComposioReferencesByIdentifiers: mocks.queryComposioReferences,
  })),
}));

vi.mock('@/libs/composio', () => ({
  getComposioClient: mocks.getComposioClient,
  isComposioConnectedAccountLookupNotFoundError: mocks.isComposioLookupNotFound,
}));
vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(() => ({
    market: {
      skills: {
        callTool: mocks.marketCallTool,
        getStatus: mocks.marketGetStatus,
      },
    },
    proxyOAuthRequest: mocks.marketProxyOAuthRequest,
  })),
}));

const authDb = (
  rows: Array<{ accessToken: string | null; accessTokenExpiresAt?: Date | null; id: string }>,
) =>
  ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue(rows) })),
        })),
      })),
    })),
  }) as unknown as LobeChatDatabase;

describe('ConnectorDataService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.composioConnectedAccountGet.mockResolvedValue({ status: 'ACTIVE' });
    mocks.getComposioClient.mockReturnValue({
      connectedAccounts: { get: mocks.composioConnectedAccountGet },
      kind: 'composio',
    });
    mocks.isComposioLookupNotFound.mockImplementation(
      (error: unknown) =>
        typeof error === 'object' && error !== null && 'status' in error && error.status === 404,
    );
    mocks.createGitHubMarketClient.mockReturnValue({ kind: 'github-market-client' });
    mocks.markComposioUnavailable.mockResolvedValue(false);
    mocks.marketCallTool.mockResolvedValue({ data: { data: [] }, success: true });
    mocks.marketGetStatus.mockResolvedValue({ connected: true, success: true });
    mocks.getAccount.mockResolvedValue({ externalAccountId: 'gmail-account', scopes: [] });
    mocks.createGmailClient.mockReturnValue({ getAccount: mocks.getAccount, kind: 'gmail-client' });
    mocks.createNotionClient.mockReturnValue({ kind: 'notion-client' });
    mocks.createTwitterClient.mockReturnValue({ kind: 'twitter-client' });
    mocks.queryComposioReferences.mockResolvedValue([]);
  });

  /** @example A connected Market GitHub provider resolves through the OAuth proxy adapter. */
  it('creates GitHub from the active Market connector', async () => {
    const client = await new ConnectorDataService(authDb([]), 'user-1').getGitHubClient();

    expect(client).toEqual({ kind: 'github-market-client' });
    expect(mocks.marketGetStatus).toHaveBeenCalledWith('github');
    expect(mocks.createGitHubMarketClient).toHaveBeenCalledWith({
      market: expect.objectContaining({ proxyOAuthRequest: mocks.marketProxyOAuthRequest }),
    });
  });

  /** @example A disconnected Market GitHub provider is excluded from Understanding. */
  it('rejects GitHub when the Market connector is not connected', async () => {
    mocks.marketGetStatus.mockResolvedValue({ connected: false, success: true });

    await expect(
      new ConnectorDataService(authDb([]), 'user-1').getGitHubClient(),
    ).rejects.toMatchObject({ code: 'github_authorization_unavailable' });
    expect(mocks.createGitHubMarketClient).not.toHaveBeenCalled();
  });

  it('creates Gmail from the first active connector and validates account ownership', async () => {
    mocks.queryComposioReferences.mockResolvedValue([
      {
        composio: {
          appSlug: 'gmail',
          connectedAccountId: 'gmail-account',
          ownerUserId: 'gmail-owner',
          status: 'ACTIVE',
        },
        id: 'gmail-a',
        isEnabled: true,
        status: 'connected',
      },
    ]);

    const client = await new ConnectorDataService(authDb([]), 'user-1').getGmailClient();

    expect(client).toEqual(expect.objectContaining({ kind: 'gmail-client' }));
    expect(mocks.createGmailClient).toHaveBeenCalledWith({
      composio: expect.objectContaining({ kind: 'composio' }),
      connectedAccountId: 'gmail-account',
      userId: 'gmail-owner',
    });
    expect(mocks.getAccount).toHaveBeenCalledOnce();
  });

  it('delegates a stale Gmail Composio 404 to ConnectorModel and excludes the client', async () => {
    /** @example A deleted Gmail connection cannot be selected as an Understanding source. */
    const notFound = Object.assign(new Error('not found'), { status: 404 });
    mocks.queryComposioReferences.mockResolvedValue([
      {
        composio: {
          appSlug: 'gmail',
          connectedAccountId: 'deleted-account',
          ownerUserId: 'gmail-owner',
          status: 'ACTIVE',
        },
        id: 'gmail-stale',
        isEnabled: true,
        status: 'connected',
      },
    ]);
    mocks.composioConnectedAccountGet.mockRejectedValue(notFound);
    mocks.markComposioUnavailable.mockResolvedValue(true);

    await expect(
      new ConnectorDataService(authDb([]), 'user-1').getGmailClient(),
    ).rejects.toMatchObject({ code: 'gmail_authorization_unavailable' });

    expect(mocks.markComposioUnavailable).toHaveBeenCalledWith('gmail-stale', 'deleted-account');
    expect(mocks.createGmailClient).not.toHaveBeenCalled();
  });

  /** @example A temporary Composio outage remains retryable by Understanding initialization. */
  it('propagates transient Gmail connected-account lookup failures', async () => {
    // ROOT CAUSE:
    //
    // The Gmail resolver swallowed unknown Composio lookup errors and converted them into permanent
    // authorization unavailability. A transient 5xx could therefore remove Gmail from a new session.
    // We now continue only for confirmed, non-retryable account-unavailable errors.
    const transientError = Object.assign(new Error('temporarily unavailable'), { status: 503 });
    mocks.queryComposioReferences.mockResolvedValue([
      {
        composio: {
          appSlug: 'gmail',
          connectedAccountId: 'gmail-account',
          ownerUserId: 'gmail-owner',
          status: 'ACTIVE',
        },
        id: 'gmail-a',
        isEnabled: true,
        status: 'connected',
      },
    ]);
    mocks.composioConnectedAccountGet.mockRejectedValue(transientError);

    await expect(new ConnectorDataService(authDb([]), 'user-1').getGmailClient()).rejects.toBe(
      transientError,
    );

    expect(mocks.markComposioUnavailable).not.toHaveBeenCalled();
  });

  /** @example An ACTIVE Notion connection resolves through the registry-backed provider client. */
  it('creates Notion from the first active Composio connector', async () => {
    mocks.queryComposioReferences.mockResolvedValue([
      {
        composio: {
          appSlug: 'notion',
          connectedAccountId: 'notion-account',
          ownerUserId: 'notion-owner',
          status: 'ACTIVE',
        },
        id: 'notion-a',
        isEnabled: true,
        status: 'connected',
      },
    ]);

    await expect(new ConnectorDataService(authDb([]), 'user-1').getNotionClient()).resolves.toEqual(
      { kind: 'notion-client' },
    );
    expect(mocks.createNotionClient).toHaveBeenCalledWith({
      composio: expect.objectContaining({ kind: 'composio' }),
      connectedAccountId: 'notion-account',
      userId: 'notion-owner',
    });
  });

  /** @example A connected Market X skill resolves through the registry-backed read-only client. */
  it('creates Twitter from the active Market connector', async () => {
    await expect(
      new ConnectorDataService(authDb([]), 'user-1').getTwitterClient(),
    ).resolves.toEqual({ kind: 'twitter-client' });
    expect(mocks.marketGetStatus).toHaveBeenCalledWith('twitter');
    expect(mocks.createTwitterClient).toHaveBeenCalledWith({
      market: { callTool: expect.any(Function) },
    });

    const [{ market }] = mocks.createTwitterClient.mock.calls[0];
    await market.callTool('search_tweets', { query: 'from:ada' });
    expect(mocks.marketCallTool).toHaveBeenCalledWith('twitter', {
      args: { query: 'from:ada' },
      tool: 'search_tweets',
    });
  });

  /** @example A disconnected Market X skill is not exposed as an available source. */
  it('rejects Twitter when the Market connector is not connected', async () => {
    mocks.marketGetStatus.mockResolvedValue({ connected: false, success: true });

    await expect(
      new ConnectorDataService(authDb([]), 'user-1').getTwitterClient(),
    ).rejects.toMatchObject({ code: 'twitter_authorization_unavailable' });
    expect(mocks.createTwitterClient).not.toHaveBeenCalled();
  });

  it('lists only providers whose connector client can currently be resolved', async () => {
    /** @example A stale Gmail connection is excluded while Market GitHub remains available. */
    const service = new ConnectorDataService(authDb([]), 'user-1');

    await expect(service.listAvailableProviderIds(['github', 'gmail', 'notion'])).resolves.toEqual([
      'github',
    ]);
  });

  /** @example Gmail without message-read scope is omitted from Understanding availability. */
  it('excludes connected Gmail accounts without read permission', async () => {
    // ROOT CAUSE:
    //
    // Connection availability only checked whether a Gmail client could be created.
    // Identity-only OAuth grants therefore entered Understanding and failed during collection.
    // We fixed this by checking the account's granted scopes as part of source availability.
    mocks.queryComposioReferences.mockResolvedValue([
      {
        composio: {
          appSlug: 'gmail',
          connectedAccountId: 'gmail-account',
          ownerUserId: 'gmail-owner',
          status: 'ACTIVE',
        },
        id: 'gmail-a',
        isEnabled: true,
        status: 'connected',
      },
    ]);
    mocks.getAccount.mockResolvedValue({
      externalAccountId: 'gmail-account',
      scopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email'],
    });

    await expect(
      new ConnectorDataService(authDb([]), 'user-1').listAvailableProviderIds(['gmail']),
    ).resolves.toEqual([]);
  });

  /** @example A temporary provider failure rejects availability instead of omitting the source. */
  it('propagates transient provider availability failures', async () => {
    // ROOT CAUSE:
    //
    // Availability used to catch every error and report the provider as disconnected.
    // Understanding then persisted a session without the temporarily failing source.
    //
    // Before: a 503 resolved to an empty provider list.
    // We fixed this by filtering only confirmed authorization/account-unavailable errors.
    const transientError = Object.assign(new Error('temporarily unavailable'), { status: 503 });
    const service = new ConnectorDataService(authDb([]), 'user-1');
    vi.spyOn(service, 'getGitHubClient').mockRejectedValue(transientError);

    await expect(service.listAvailableProviderIds(['github'])).rejects.toBe(transientError);
  });
});
