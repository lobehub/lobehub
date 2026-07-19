import { ConnectorDataError } from '@lobechat/connector-data';
import type { GmailConnectorClient, GmailMessage } from '@lobechat/connector-data/gmail';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UnderstandingSourceIdentificationError } from '../types';
import {
  createGmailUnderstandingProvider,
  GMAIL_PROFILE_QUERIES,
  gmailUnderstandingRegistration,
} from './gmail';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getComposioClient: vi.fn(),
  toXml: vi.fn(),
}));

vi.mock('@lobechat/connector-data/gmail', () => ({
  createGmailConnectorClient: mocks.createClient,
  toGmailMessagesXml: mocks.toXml,
}));

vi.mock('@/libs/composio', () => ({
  getComposioClient: mocks.getComposioClient,
}));

const collectionContext = { userId: 'user-1' };
const candidate = {
  candidateId: 'connector:connector-1',
  credentialOrigin: 'connector' as const,
  credentialReference: 'connector:connector-1',
  provider: 'gmail' as const,
};
const source = {
  ...candidate,
  credential: { connectedAccountId: 'ca-1' },
  externalAccountId: 'ca-1',
  grantedScopes: ['gmail.readonly'],
  id: 'gmail:ca-1',
};
const connector = {
  composio: { appSlug: 'gmail', connectedAccountId: 'ca-1', status: 'ACTIVE' },
  id: 'connector-1',
  isEnabled: true,
  status: 'connected',
};
const messages: GmailMessage[] = [
  {
    bodyPreview: 'Product usage update',
    id: 'message-1',
    labels: ['CATEGORY_UPDATES', 'INBOX'],
    sender: 'updates@example.com',
    subject: 'Usage report',
  },
];

describe('createGmailUnderstandingProvider', () => {
  let client: GmailConnectorClient;
  const providerDependencies = {
    composio: {
      connectedAccounts: { get: vi.fn(), list: vi.fn() },
      tools: { execute: vi.fn() },
    },
    findConnector: vi.fn().mockResolvedValue(connector),
    queryConnectors: vi.fn().mockResolvedValue([connector]),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client = {
      getAccount: vi.fn().mockResolvedValue({
        email: 'neko@example.com',
        externalAccountId: 'ca-1',
        scopes: ['gmail.readonly', 'openid'],
      }),
      searchMessages: vi.fn().mockResolvedValue(messages),
    };
    mocks.createClient.mockReturnValue(client);
    mocks.toXml.mockReturnValue('<messages>GMAIL_XML_SENTINEL</messages>');
  });

  it('exposes provider metadata and the eight provider-owned search queries', () => {
    expect(createGmailUnderstandingProvider()).toMatchObject({
      id: 'gmail',
      originPriority: ['connector', 'integration', 'auth_account'],
      requiredScopes: [],
      usefulOptionalScopes: ['gmail.readonly'],
    });
    expect(GMAIL_PROFILE_QUERIES).toEqual([
      'newer_than:90d',
      'newer_than:180d receipt',
      'newer_than:180d invoice',
      'newer_than:180d subscription',
      'newer_than:180d briefing',
      'newer_than:180d report',
      'newer_than:180d credits',
      'newer_than:180d AI',
    ]);
  });

  it('discovers active Gmail connectors without creating clients or resolving accounts', async () => {
    const provider = createGmailUnderstandingProvider({
      findConnector: providerDependencies.findConnector,
      queryConnectors: vi.fn().mockResolvedValue([
        connector,
        {
          composio: { appSlug: 'gmail', connectedAccountId: 'ca-2', status: 'PENDING' },
          id: 'connector-pending',
          isEnabled: true,
          status: 'connected',
        },
        {
          composio: { appSlug: 'gmail', connectedAccountId: 'ca-3', status: 'ACTIVE' },
          id: 'connector-disabled',
          isEnabled: false,
          status: 'connected',
        },
      ]),
    });

    await expect(provider.discoverSources(collectionContext)).resolves.toEqual([candidate]);
    expect(mocks.getComposioClient).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('materializes the production registration without resolving the Composio client', () => {
    const { provider } = gmailUnderstandingRegistration.materialize({
      db: {} as never,
      userId: 'user-1',
    });

    expect(provider.id).toBe('gmail');
    expect(mocks.getComposioClient).not.toHaveBeenCalled();
  });

  it('resolves a Composio factory only when Gmail account identification needs it', async () => {
    const composioFactory = vi.fn(() => providerDependencies.composio);
    const provider = createGmailUnderstandingProvider({
      ...providerDependencies,
      composio: composioFactory,
    });

    await expect(provider.discoverSources(collectionContext)).resolves.toEqual([candidate]);
    expect(composioFactory).not.toHaveBeenCalled();

    await expect(provider.identifySource(candidate, collectionContext)).resolves.toMatchObject({
      externalAccountId: 'ca-1',
    });
    expect(composioFactory).toHaveBeenCalledTimes(1);
  });

  it('resolves a Composio factory only when Gmail collection needs it', async () => {
    const composioFactory = vi.fn(() => providerDependencies.composio);
    const provider = createGmailUnderstandingProvider({
      ...providerDependencies,
      composio: composioFactory,
    });

    await provider.collect(source, collectionContext);

    expect(composioFactory).toHaveBeenCalledTimes(1);
  });

  it('fails safely when the lazy Composio client cannot be created for Gmail use', async () => {
    const provider = createGmailUnderstandingProvider({
      ...providerDependencies,
      composio: () => {
        throw new Error('Composio client unavailable');
      },
    });

    await expect(provider.identifySource(candidate, collectionContext)).rejects.toMatchObject({
      name: 'UnderstandingSourceIdentificationError',
      retryable: false,
    });
    await expect(provider.collect(source, collectionContext)).rejects.toThrow(
      'Composio client unavailable',
    );
  });

  it('resolves the connector before client creation and uses getAccount for stable identity', async () => {
    const order: string[] = [];
    const findConnector = vi.fn(async () => {
      order.push('connector');
      return connector;
    });
    const getAccount = vi.fn(async () => {
      order.push('account');
      return {
        email: 'neko@example.com',
        externalAccountId: 'ca-1',
        scopes: ['openid', 'gmail.readonly'],
      };
    });
    mocks.createClient.mockImplementation(() => {
      order.push('client');
      return { ...client, getAccount };
    });

    await expect(
      createGmailUnderstandingProvider({
        ...providerDependencies,
        findConnector,
      }).identifySource(candidate, collectionContext),
    ).resolves.toEqual({
      credential: { connectedAccountId: 'ca-1' },
      displayName: 'neko@example.com',
      externalAccountId: 'ca-1',
      grantedScopes: ['gmail.readonly', 'openid'],
    });
    expect(order).toEqual(['connector', 'client', 'account']);
  });

  it('preserves transient identification retryability without leaking connector details', async () => {
    const upstream = new ConnectorDataError({
      code: 'gmail_request_failed',
      operation: 'getAccount',
      provider: 'gmail',
      retryable: true,
    });
    upstream.message = '503 upstream bearer-token response';
    client.getAccount = vi.fn().mockRejectedValue(upstream);
    mocks.createClient.mockReturnValue(client);

    let error: unknown;
    try {
      await createGmailUnderstandingProvider(providerDependencies).identifySource(
        candidate,
        collectionContext,
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(UnderstandingSourceIdentificationError);
    expect(error).toMatchObject({ retryable: true });
    expect(String(error)).not.toMatch(/503|bearer-token|upstream/);
  });

  it('runs all categories concurrently, applies domain selection, and formats XML', async () => {
    const firstSearch = Promise.withResolvers<void>();
    const searchMessages = vi.fn(async ({ query }: { query: string }) => {
      if (query === GMAIL_PROFILE_QUERIES[0]) await firstSearch.promise;
      return [{ ...messages[0], id: query }];
    });
    client.searchMessages = searchMessages;
    const collecting = createGmailUnderstandingProvider(providerDependencies).collect(
      source,
      collectionContext,
    );
    await vi.waitFor(() => expect(searchMessages).toHaveBeenCalledTimes(8));
    firstSearch.resolve();

    const result = await collecting;
    expect(mocks.toXml).toHaveBeenCalledWith(
      GMAIL_PROFILE_QUERIES.slice(0, 6).map((id) => ({ ...messages[0], id })),
    );
    expect(result).toEqual({
      diagnostics: {
        errors: [],
        evidenceCount: 6,
        failedCount: 0,
        succeededCount: 8,
      },
      sourceBrief: expect.stringContaining('GMAIL_XML_SENTINEL'),
      sourceCount: 6,
    });
  });

  it('deduplicates messages, balances sender domains, and deprioritizes promotions', async () => {
    const alpha = Array.from({ length: 20 }, (_, index) => ({
      ...messages[0],
      id: `alpha-${index}`,
      sender: 'updates@alpha.test',
    }));
    const beta = { ...messages[0], id: 'beta', sender: 'updates@beta.test' };
    const promotion = {
      ...messages[0],
      id: 'promotion',
      labels: ['CATEGORY_PROMOTIONS'],
      sender: 'offers@promo.test',
    };
    client.searchMessages = vi.fn(async ({ query }) =>
      query === GMAIL_PROFILE_QUERIES[0]
        ? [...alpha, beta, promotion, { ...beta, sender: 'duplicate@other.test' }]
        : [],
    );

    await createGmailUnderstandingProvider(providerDependencies).collect(source, collectionContext);

    expect(mocks.toXml).toHaveBeenCalledWith([
      alpha[0],
      beta,
      alpha[1],
      alpha[2],
      alpha[3],
      alpha[4],
      alpha[5],
      promotion,
    ]);
  });

  it('continues after category failures and maps ConnectorDataError to safe diagnostics', async () => {
    const searchMessages = vi.fn(async ({ query }: { query: string }) => {
      if (query === GMAIL_PROFILE_QUERIES[1]) {
        throw new ConnectorDataError({
          code: 'secret-token-code',
          operation: 'secret-message-operation',
          provider: 'gmail',
          retryable: false,
        });
      }
      return messages;
    });
    client.searchMessages = searchMessages;
    const result = await createGmailUnderstandingProvider(providerDependencies).collect(
      source,
      collectionContext,
    );

    expect(result.diagnostics).toEqual({
      errors: [
        {
          code: 'GMAIL_SEARCH_FAILED',
          message: 'Gmail search category failed',
          operation: 'receipts',
          provider: 'gmail',
          retryable: false,
        },
      ],
      evidenceCount: 1,
      failedCount: 1,
      succeededCount: 7,
    });
    expect(result.sourceBrief).toContain('GMAIL_XML_SENTINEL');
    expect(JSON.stringify(result)).not.toContain('secret-token-code');
    expect(JSON.stringify(result)).not.toContain('secret-message-operation');
  });

  it('returns all terminal category failures with safe operation diagnostics', async () => {
    client.searchMessages = vi.fn().mockRejectedValue(
      new ConnectorDataError({
        code: 'secret-token-code',
        operation: 'secret-message-operation',
        provider: 'gmail',
        retryable: false,
      }),
    );

    const result = await createGmailUnderstandingProvider(providerDependencies).collect(
      source,
      collectionContext,
    );

    expect(result).toEqual({
      diagnostics: {
        errors: [
          'recent',
          'receipts',
          'invoices',
          'subscriptions',
          'briefings',
          'reports',
          'credits',
          'ai',
        ].map((operation) => ({
          code: 'GMAIL_SEARCH_FAILED',
          message: 'Gmail search category failed',
          operation,
          provider: 'gmail',
          retryable: false,
        })),
        evidenceCount: 0,
        failedCount: 8,
        succeededCount: 0,
      },
      sourceBrief: '',
      sourceCount: 0,
    });
    expect(JSON.stringify(result)).not.toContain('secret-token-code');
    expect(JSON.stringify(result)).not.toContain('secret-message-operation');
  });

  it('retains category failures when fulfilled searches have no usable messages', async () => {
    client.searchMessages = vi.fn(async ({ query }) => {
      if (query === GMAIL_PROFILE_QUERIES[3]) {
        throw new ConnectorDataError({
          code: 'secret-token-code',
          operation: 'secret-message-operation',
          provider: 'gmail',
          retryable: true,
        });
      }
      return [];
    });
    const result = await createGmailUnderstandingProvider(providerDependencies).collect(
      source,
      collectionContext,
    );

    expect(result).toEqual({
      diagnostics: {
        errors: [
          {
            code: 'GMAIL_SEARCH_FAILED',
            message: 'Gmail search category failed',
            operation: 'subscriptions',
            provider: 'gmail',
            retryable: true,
          },
        ],
        evidenceCount: 0,
        failedCount: 1,
        succeededCount: 7,
      },
      sourceBrief: '',
      sourceCount: 0,
    });
    expect(mocks.toXml).not.toHaveBeenCalled();
  });
});
