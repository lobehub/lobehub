import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { ConnectorDataService } from './index';

const mocks = vi.hoisted(() => ({
  createGitHubClient: vi.fn(),
  createGmailClient: vi.fn(),
  ensureFreshConnectorToken: vi.fn(),
  findById: vi.fn(),
  getAccount: vi.fn(),
  getComposioClient: vi.fn(),
  initWithEnvKey: vi.fn(),
  queryComposioReferences: vi.fn(),
  queryReferences: vi.fn(),
}));

vi.mock('@lobechat/connector-data/github', () => ({
  createGitHubConnectorClient: mocks.createGitHubClient,
}));

vi.mock('@lobechat/connector-data/gmail', () => ({
  createGmailConnectorClient: mocks.createGmailClient,
}));

vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn(() => ({
    findById: mocks.findById,
    queryComposioReferencesByIdentifiers: mocks.queryComposioReferences,
    queryReferencesByIdentifiers: mocks.queryReferences,
  })),
}));

vi.mock('@/libs/composio', () => ({ getComposioClient: mocks.getComposioClient }));
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
    mocks.getComposioClient.mockReturnValue({ kind: 'composio' });
    mocks.initWithEnvKey.mockResolvedValue({ kind: 'gatekeeper' });
    mocks.createGitHubClient.mockReturnValue({ kind: 'github-client' });
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
    expect(mocks.createGitHubClient).toHaveBeenCalledWith({ accessToken: 'fresh-token' });
  });

  it('falls back to a personal GitHub auth account without initializing KeyVault', async () => {
    const client = await new ConnectorDataService(
      authDb([{ accessToken: 'account-token', id: 'account-a' }]),
      'user-1',
    ).getGitHubClient();

    expect(client).toEqual({ kind: 'github-client' });
    expect(mocks.initWithEnvKey).not.toHaveBeenCalled();
    expect(mocks.createGitHubClient).toHaveBeenCalledWith({ accessToken: 'account-token' });
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

    expect(mocks.createGitHubClient).toHaveBeenCalledOnce();
    expect(mocks.createGitHubClient).toHaveBeenCalledWith({ accessToken: 'account-token' });
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
    expect(mocks.createGitHubClient).not.toHaveBeenCalled();
  });

  it.each([
    { accessTokenExpiresAt: null, label: 'null expiry' },
    { accessTokenExpiresAt: new Date('2099-01-01T00:00:00.000Z'), label: 'valid expiry' },
  ])('accepts an auth account with $label', async ({ accessTokenExpiresAt }) => {
    await new ConnectorDataService(
      authDb([{ accessToken: 'account-token', accessTokenExpiresAt, id: 'account-a' }]),
      'user-1',
    ).getGitHubClient();

    expect(mocks.createGitHubClient).toHaveBeenCalledWith({ accessToken: 'account-token' });
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
      composio: { kind: 'composio' },
      connectedAccountId: 'gmail-account',
      userId: 'gmail-owner',
    });
    expect(mocks.getAccount).toHaveBeenCalledOnce();
  });
});
