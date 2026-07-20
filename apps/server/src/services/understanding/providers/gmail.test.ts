import { ConnectorDataError } from '@lobechat/connector-data';
import type { GmailConnectorClient, GmailMessage } from '@lobechat/connector-data/gmail';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createUnderstandingProviderRegistry } from '.';
import { createGmailUnderstandingProvider, GMAIL_PROFILE_QUERIES } from './gmail';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), toXml: vi.fn() }));

vi.mock('@lobechat/connector-data/gmail', () => ({
  createGmailConnectorClient: mocks.createClient,
  toGmailMessagesXml: mocks.toXml,
}));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/schemas', () => ({ account: {} }));
vi.mock('@/libs/composio', () => ({ getComposioClient: vi.fn() }));
vi.mock('@/server/services/connector/tokens', () => ({ ensureFreshConnectorToken: vi.fn() }));

const context = { userId: 'user-1' };
const connector = {
  composio: { appSlug: 'gmail', connectedAccountId: 'ca-1', status: 'ACTIVE' },
  id: 'connector-1',
  isEnabled: true,
  status: 'connected',
};
const message: GmailMessage = {
  bodyPreview: 'Product usage update',
  id: 'message-1',
  labels: ['CATEGORY_UPDATES', 'INBOX'],
  sender: 'updates@example.com',
  subject: 'Usage report',
};

describe('Gmail Understanding provider', () => {
  let client: GmailConnectorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = {
      getAccount: vi.fn().mockResolvedValue({
        email: 'neko@example.com',
        externalAccountId: 'ca-1',
        scopes: ['gmail.readonly'],
      }),
      searchMessages: vi.fn().mockResolvedValue([message]),
    };
    mocks.createClient.mockReturnValue(client);
    mocks.toXml.mockReturnValue('<messages>GMAIL_XML_SENTINEL</messages>');
  });

  it('freshly resolves Gmail connector OAuth and emits fenced XML context', async () => {
    const queryConnectors = vi.fn().mockResolvedValue([connector]);
    const findConnector = vi.fn().mockResolvedValue(connector);
    const provider = createUnderstandingProviderRegistry([
      createGmailUnderstandingProvider({
        composio: {} as never,
        findConnector,
        queryConnectors,
      }),
    ]).get('gmail')!;

    const result = await provider.collect(context);

    expect(queryConnectors).toHaveBeenCalledOnce();
    expect(findConnector).toHaveBeenCalledWith('connector-1');
    expect(client.searchMessages).toHaveBeenCalledTimes(GMAIL_PROFILE_QUERIES.length);
    expect(result.context).toContain('```xml\n<messages>GMAIL_XML_SENTINEL</messages>\n```');
    expect(result.sourceCount).toBe(1);
  });

  it('ignores inactive connectors without resolving Composio credentials', async () => {
    const findConnector = vi.fn();
    const provider = createUnderstandingProviderRegistry([
      createGmailUnderstandingProvider({
        findConnector,
        queryConnectors: async () => [{ ...connector, isEnabled: false }],
      }),
    ]).get('gmail')!;

    await expect(provider.collect(context)).resolves.toMatchObject({
      context: '',
      diagnostics: { failedCount: 1, succeededCount: 0 },
      sourceCount: 0,
    });
    expect(findConnector).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('preserves safe diagnostics when one search category fails permanently', async () => {
    client.searchMessages = vi.fn(async ({ query }) => {
      if (query === GMAIL_PROFILE_QUERIES[1]) {
        throw new ConnectorDataError({
          code: 'private_code',
          operation: 'private_operation',
          provider: 'gmail',
          retryable: false,
        });
      }
      return [message];
    });
    const provider = createUnderstandingProviderRegistry([
      createGmailUnderstandingProvider({
        composio: {} as never,
        findConnector: async () => connector,
        queryConnectors: async () => [connector],
      }),
    ]).get('gmail')!;

    const result = await provider.collect(context);

    expect(result.diagnostics.errors).toEqual([
      {
        code: 'GMAIL_SEARCH_FAILED',
        message: 'gmail search failed',
        operation: 'search',
        provider: 'gmail',
        retryable: false,
      },
    ]);
    expect(result.context).toContain('GMAIL_XML_SENTINEL');
    expect(JSON.stringify(result)).not.toContain('private_code');
  });

  it('rethrows a sanitized transient Gmail account identification failure', async () => {
    client.getAccount = vi.fn().mockRejectedValue(
      new ConnectorDataError({
        code: 'private_code',
        operation: 'private_operation',
        provider: 'gmail',
        retryable: true,
      }),
    );
    const provider = createUnderstandingProviderRegistry([
      createGmailUnderstandingProvider({
        composio: {} as never,
        findConnector: async () => connector,
        queryConnectors: async () => [connector],
      }),
    ]).get('gmail')!;

    const error = await provider.collect(context).catch((caught) => caught);
    expect(error).toMatchObject({ name: 'UnderstandingProviderRetryableError', retryable: true });
    expect(String(error)).not.toContain('private');
  });

  it('rethrows transient Gmail collection failures for workflow retry', async () => {
    client.searchMessages = vi.fn().mockRejectedValue(
      new ConnectorDataError({
        code: 'private_code',
        operation: 'private_operation',
        provider: 'gmail',
        retryable: true,
      }),
    );
    const provider = createUnderstandingProviderRegistry([
      createGmailUnderstandingProvider({
        composio: {} as never,
        findConnector: async () => connector,
        queryConnectors: async () => [connector],
      }),
    ]).get('gmail')!;

    const error = await provider.collect(context).catch((caught) => caught);
    expect(error).toMatchObject({ name: 'UnderstandingProviderRetryableError', retryable: true });
    expect(String(error)).not.toContain('private');
  });
});
