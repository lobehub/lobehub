import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { ConnectorDataService } from './index';

const mocks = vi.hoisted(() => ({
  composioConnectedAccountGet: vi.fn(),
  createGitHubComposioClient: vi.fn(),
  createGitHubOAuthClient: vi.fn(),
  createGmailClient: vi.fn(),
  ensureFreshConnectorToken: vi.fn(),
  findById: vi.fn(),
  getAccount: vi.fn(),
  getComposioClient: vi.fn(),
  initWithEnvKey: vi.fn(),
  isComposioNotFound: vi.fn(),
  markComposioUnavailable: vi.fn(),
  queryComposioReferences: vi.fn(),
  queryReferences: vi.fn(),
}));

vi.mock('@lobechat/connector-data/github', () => ({
  createGitHubComposioConnectorClient: mocks.createGitHubComposioClient,
  createGitHubOAuthConnectorClient: mocks.createGitHubOAuthClient,
}));

vi.mock('@lobechat/connector-data/gmail', () => ({
  createGmailConnectorClient: mocks.createGmailClient,
}));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn(() => ({
    findById: mocks.findById,
    markComposioConnectionUnavailable: mocks.markComposioUnavailable,
    queryComposioReferencesByIdentifiers: mocks.queryComposioReferences,
    queryReferencesByIdentifiers: mocks.queryReferences,
  })),
}));

vi.mock('@/libs/composio', () => ({
  getComposioClient: mocks.getComposioClient,
  isComposioConnectedAccountNotFoundError: mocks.isComposioNotFound,
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: mocks.initWithEnvKey },
}));
vi.mock('@/server/services/connector/tokens', () => ({
  ensureFreshConnectorToken: mocks.ensureFreshConnectorToken,
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
    mocks.initWithEnvKey.mockResolvedValue({ kind: 'gatekeeper' });
    mocks.isComposioNotFound.mockImplementation(
      (error: unknown) =>
        typeof error === 'object' && error !== null && 'status' in error && error.status === 404,
    );
    mocks.createGitHubComposioClient.mockReturnValue({ kind: 'github-composio-client' });
    mocks.createGitHubOAuthClient.mockReturnValue({ kind: 'github-client' });
    mocks.markComposioUnavailable.mockResolvedValue(false);
    mocks.getAccount.mockResolvedValue({ externalAccountId: 'gmail-account', scopes: [] });
    mocks.createGmailClient.mockReturnValue({ getAccount: mocks.getAccount, kind: 'gmail-client' });
    mocks.queryReferences.mockResolvedValue([]);
    mocks.queryComposioReferences.mockResolvedValue([]);
  });

  it('selects the first stable active GitHub connector and refreshes its OAuth token', async () => {
    mocks.queryReferences.mockResolvedValue([
      { id: 'connector-z', isEnabled: true, status: 'connected' },
      { id: 'connector-a', isEnabled: true, status: 'connected' },
    ]);
    mocks.findById.mockResolvedValue({
      credentials: { accessToken: 'old-token', type: 'oauth2' },
      id: 'connector-a',
      identifier: 'github',
      isEnabled: true,
      status: 'connected',
    });
    mocks.ensureFreshConnectorToken.mockResolvedValue({
      credentials: { accessToken: 'fresh-token', type: 'oauth2' },
      id: 'connector-a',
      identifier: 'github',
      isEnabled: true,
      status: 'connected',
    });

    const client = await new ConnectorDataService(authDb([]), 'user-1').getGitHubClient();

    expect(client).toEqual({ kind: 'github-client' });
    expect(mocks.findById).toHaveBeenCalledWith('connector-a');
    expect(mocks.ensureFreshConnectorToken).toHaveBeenCalledOnce();
    expect(mocks.createGitHubOAuthClient).toHaveBeenCalledWith({ accessToken: 'fresh-token' });
  });

  it('falls back to a personal GitHub auth account without initializing KeyVault', async () => {
    const client = await new ConnectorDataService(
      authDb([{ accessToken: 'account-token', id: 'account-a' }]),
      'user-1',
    ).getGitHubClient();

    expect(client).toEqual({ kind: 'github-client' });
    expect(mocks.initWithEnvKey).not.toHaveBeenCalled();
    expect(mocks.createGitHubOAuthClient).toHaveBeenCalledWith({ accessToken: 'account-token' });
  });

  it('skips an expired refreshed connector and falls back to a valid auth account', async () => {
    mocks.queryReferences.mockResolvedValue([
      { id: 'connector-a', isEnabled: true, status: 'connected' },
    ]);
    mocks.findById.mockResolvedValue({
      credentials: { accessToken: 'old-token', type: 'oauth2' },
      id: 'connector-a',
      identifier: 'github',
      isEnabled: true,
      status: 'connected',
    });
    mocks.ensureFreshConnectorToken.mockResolvedValue({
      credentials: { accessToken: 'expired-token', expiresAt: 1, type: 'oauth2' },
      id: 'connector-a',
      identifier: 'github',
      isEnabled: true,
      status: 'connected',
    });

    await new ConnectorDataService(
      authDb([
        {
          accessToken: 'account-token',
          accessTokenExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
          id: 'account-a',
        },
      ]),
      'user-1',
    ).getGitHubClient();

    expect(mocks.createGitHubOAuthClient).toHaveBeenCalledOnce();
    expect(mocks.createGitHubOAuthClient).toHaveBeenCalledWith({ accessToken: 'account-token' });
  });

  it.each([
    { accessTokenExpiresAt: new Date('2000-01-01T00:00:00.000Z'), label: 'expired' },
    { accessTokenExpiresAt: new Date(Date.now() + 30_000), label: 'inside the safety window' },
  ])('skips $label auth accounts', async ({ accessTokenExpiresAt }) => {
    const { ConnectorDataError } = await import('@lobechat/connector-data');
    const service = new ConnectorDataService(
      authDb([
        {
          accessToken: 'expired-account-token',
          accessTokenExpiresAt,
          id: 'account-a',
        },
      ]),
      'user-1',
    );

    await expect(service.getGitHubClient()).rejects.toBeInstanceOf(ConnectorDataError);
    expect(mocks.createGitHubOAuthClient).not.toHaveBeenCalled();
  });

  it.each([
    { accessTokenExpiresAt: null, label: 'null expiry' },
    { accessTokenExpiresAt: new Date('2099-01-01T00:00:00.000Z'), label: 'valid expiry' },
  ])('accepts an auth account with $label', async ({ accessTokenExpiresAt }) => {
    await new ConnectorDataService(
      authDb([{ accessToken: 'account-token', accessTokenExpiresAt, id: 'account-a' }]),
      'user-1',
    ).getGitHubClient();

    expect(mocks.createGitHubOAuthClient).toHaveBeenCalledWith({ accessToken: 'account-token' });
  });

  it('creates GitHub through Composio while preserving the shared connector interface', async () => {
    /** @example An ACTIVE server-resolved Composio account is preferred over OAuth fallback. */
    mocks.queryComposioReferences.mockResolvedValue([
      {
        composio: {
          appSlug: 'github',
          connectedAccountId: 'github-account',
          ownerUserId: 'github-owner',
          status: 'ACTIVE',
        },
        id: 'github-a',
        isEnabled: true,
        status: 'connected',
      },
    ]);

    const client = await new ConnectorDataService(authDb([]), 'user-1').getGitHubClient();

    expect(client).toEqual({ kind: 'github-composio-client' });
    expect(mocks.composioConnectedAccountGet).toHaveBeenCalledWith('github-account');
    expect(mocks.createGitHubComposioClient).toHaveBeenCalledWith({
      composio: expect.objectContaining({ kind: 'composio' }),
      connectedAccountId: 'github-account',
    });
  });

  it('delegates a stale GitHub Composio 404 to ConnectorModel and falls back to OAuth', async () => {
    /** @example A deleted Composio account is persisted as unavailable before fallback. */
    const notFound = Object.assign(new Error('not found'), { status: 404 });
    mocks.queryComposioReferences.mockResolvedValue([
      {
        composio: {
          appSlug: 'github',
          connectedAccountId: 'deleted-account',
          ownerUserId: 'github-owner',
          status: 'ACTIVE',
        },
        id: 'github-stale',
        isEnabled: true,
        status: 'connected',
      },
    ]);
    mocks.composioConnectedAccountGet.mockRejectedValue(notFound);
    mocks.markComposioUnavailable.mockResolvedValue(true);

    const client = await new ConnectorDataService(
      authDb([{ accessToken: 'account-token', id: 'account-a' }]),
      'user-1',
    ).getGitHubClient();

    expect(client).toEqual({ kind: 'github-client' });
    expect(mocks.markComposioUnavailable).toHaveBeenCalledWith('github-stale');
    expect(mocks.createGitHubOAuthClient).toHaveBeenCalledWith({ accessToken: 'account-token' });
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

    expect(mocks.markComposioUnavailable).toHaveBeenCalledWith('gmail-stale');
    expect(mocks.createGmailClient).not.toHaveBeenCalled();
  });

  it('lists only providers whose connector client can currently be resolved', async () => {
    /** @example A stale Gmail connection is excluded while GitHub OAuth remains available. */
    const service = new ConnectorDataService(
      authDb([{ accessToken: 'account-token', id: 'account-a' }]),
      'user-1',
    );

    await expect(service.listAvailableProviderIds(['github', 'gmail'])).resolves.toEqual([
      'github',
    ]);
  });
});
