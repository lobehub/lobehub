import { describe, expect, it, vi } from 'vitest';

import { ConnectorDataError } from '../errors';
import { createGmailConnectorClient } from './client';

describe('createGmailConnectorClient', () => {
  it('loads an active Gmail account owned by the configured user', async () => {
    const list = vi.fn().mockResolvedValue({
      items: [
        {
          data: { email: 'Neko <neko@example.com>', scopes: ['openid', 'gmail.readonly'] },
          id: 'account-1',
          status: 'ACTIVE',
          toolkit: { slug: 'GMAIL' },
        },
      ],
      totalPages: 1,
    });
    const get = vi.fn();
    const client = createGmailConnectorClient({
      composio: { connectedAccounts: { get, list }, tools: { execute: vi.fn() } },
      connectedAccountId: 'account-1',
      userId: 'user-1',
    });

    await expect(client.getAccount()).resolves.toEqual({
      email: 'neko@example.com',
      externalAccountId: 'account-1',
      scopes: ['gmail.readonly', 'openid'],
    });
    expect(list).toHaveBeenCalledWith({
      limit: 100,
      toolkitSlugs: ['gmail'],
      userIds: ['user-1'],
    });
    expect(get).not.toHaveBeenCalled();
  });

  it('follows at most three ownership pages and loads missing account details', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ items: [], nextCursor: 'page-2', totalPages: 9 })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'account-1',
            status: 'ACTIVE',
            toolkit: { slug: 'gmail' },
          },
        ],
        totalPages: 9,
      });
    const get = vi.fn().mockResolvedValue({
      data: { email: 'detail@example.com', scope: 'openid,gmail.readonly' },
      id: 'account-1',
      status: 'ACTIVE',
      toolkit: { slug: 'gmail' },
    });
    const client = createGmailConnectorClient({
      composio: { connectedAccounts: { get, list }, tools: { execute: vi.fn() } },
      connectedAccountId: 'account-1',
      userId: 'user-1',
    });

    await expect(client.getAccount()).resolves.toEqual({
      email: 'detail@example.com',
      externalAccountId: 'account-1',
      scopes: ['gmail.readonly', 'openid'],
    });
    expect(list).toHaveBeenNthCalledWith(2, {
      cursor: 'page-2',
      limit: 100,
      toolkitSlugs: ['gmail'],
      userIds: ['user-1'],
    });
    expect(get).toHaveBeenCalledWith('account-1');
  });

  it('loads OAuth2 scopes and email from the real Composio state.val shape', async () => {
    let accessTokenRead = false;
    const val = {
      email: 'sdk@example.com',
      scope: 'openid gmail.readonly',
      status: 'ACTIVE',
      get access_token(): never {
        accessTokenRead = true;
        throw new Error('access token must not be read');
      },
    };
    const list = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'account-1',
          state: { authScheme: 'OAUTH2', val },
          toolkit: { slug: 'gmail' },
        },
      ],
      totalPages: 1,
    });
    const client = createGmailConnectorClient({
      composio: { connectedAccounts: { get: vi.fn(), list }, tools: { execute: vi.fn() } },
      connectedAccountId: 'account-1',
      userId: 'user-1',
    });

    await expect(client.getAccount()).resolves.toEqual({
      email: 'sdk@example.com',
      externalAccountId: 'account-1',
      scopes: ['gmail.readonly', 'openid'],
    });
    expect(accessTokenRead).toBe(false);
  });

  it('loads missing OAuth2 scopes from a real SDK-shaped account detail', async () => {
    const list = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'account-1',
          state: { authScheme: 'OAUTH2', val: { status: 'ACTIVE' } },
          toolkit: { slug: 'gmail' },
        },
      ],
      totalPages: 1,
    });
    const get = vi.fn().mockResolvedValue({
      id: 'account-1',
      state: {
        authScheme: 'OAUTH2',
        val: { scope: 'gmail.readonly profile', status: 'ACTIVE' },
      },
      toolkit: { slug: 'gmail' },
    });
    const client = createGmailConnectorClient({
      composio: { connectedAccounts: { get, list }, tools: { execute: vi.fn() } },
      connectedAccountId: 'account-1',
      userId: 'user-1',
    });

    await expect(client.getAccount()).resolves.toMatchObject({
      externalAccountId: 'account-1',
      scopes: ['gmail.readonly', 'profile'],
    });
    expect(get).toHaveBeenCalledWith('account-1');
  });

  it.each([
    {
      detailData: { scopes: ['gmail.readonly'] },
      expected: { email: 'list@example.com', scopes: ['gmail.readonly'] },
      listData: { email: 'list@example.com' },
    },
    {
      detailData: { email: 'detail@example.com' },
      expected: { email: 'detail@example.com', scopes: ['gmail.readonly'] },
      listData: { scopes: ['gmail.readonly'] },
    },
  ])('merges partially populated list and detail accounts', async ({ detailData, expected, listData }) => {
    const list = vi.fn().mockResolvedValue({
      items: [
        {
          data: listData,
          id: 'account-1',
          status: 'ACTIVE',
          toolkit: { slug: 'gmail' },
        },
      ],
      totalPages: 1,
    });
    const get = vi.fn().mockResolvedValue({
      data: detailData,
      id: 'account-1',
      status: 'ACTIVE',
      toolkit: { slug: 'gmail' },
    });
    const client = createGmailConnectorClient({
      composio: { connectedAccounts: { get, list }, tools: { execute: vi.fn() } },
      connectedAccountId: 'account-1',
      userId: 'user-1',
    });

    await expect(client.getAccount()).resolves.toMatchObject({
      externalAccountId: 'account-1',
      ...expected,
    });
    expect(get).toHaveBeenCalledWith('account-1');
  });

  it('does not enumerate unrelated account fields', async () => {
    const account = {
      id: 'account-1',
      status: 'ACTIVE',
      toolkit: { slug: 'gmail' },
      get unrelated(): never {
        throw new Error('unrelated account field accessed');
      },
    };
    const response = {
      items: [account],
      totalPages: 1,
      get unrelated(): never {
        throw new Error('unrelated list response field accessed');
      },
    };
    const client = createGmailConnectorClient({
      composio: {
        connectedAccounts: {
          get: vi.fn().mockResolvedValue(account),
          list: vi.fn().mockResolvedValue(response),
        },
        tools: { execute: vi.fn() },
      },
      connectedAccountId: 'account-1',
      userId: 'user-1',
    });

    await expect(client.getAccount()).resolves.toMatchObject({
      externalAccountId: 'account-1',
    });
  });

  it('inspects at most 100 connected accounts per page', async () => {
    let accessedBeyondBound = false;
    const items = Array.from({ length: 100 }, (_, index) => ({
      id: `other-${index}`,
      status: 'ACTIVE',
      toolkit: { slug: 'gmail' },
    }));
    items.length = 1_000_000;
    const proxiedItems = new Proxy(items, {
      get: (target, property, receiver) => {
        if (property === '100') {
          accessedBeyondBound = true;
          throw new Error('account beyond page bound accessed');
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const client = createGmailConnectorClient({
      composio: {
        connectedAccounts: {
          get: vi.fn(),
          list: vi.fn().mockResolvedValue({ items: proxiedItems, totalPages: 1 }),
        },
        tools: { execute: vi.fn() },
      },
      connectedAccountId: 'account-1',
      userId: 'user-1',
    });

    await expect(client.getAccount()).rejects.toBeInstanceOf(ConnectorDataError);
    expect(accessedBeyondBound).toBe(false);
  });

  it.each([
    { id: 'account-1', status: 'EXPIRED', toolkit: { slug: 'gmail' } },
    { id: 'account-1', status: 'ACTIVE', toolkit: { slug: 'github' } },
    { id: 'account-1', isDisabled: true, status: 'ACTIVE', toolkit: { slug: 'gmail' } },
  ])('rejects inactive, disabled, or non-Gmail accounts', async (account) => {
    const client = createGmailConnectorClient({
      composio: {
        connectedAccounts: {
          get: vi.fn(),
          list: vi.fn().mockResolvedValue({ items: [account], totalPages: 1 }),
        },
        tools: { execute: vi.fn() },
      },
      connectedAccountId: 'account-1',
      userId: 'user-1',
    });

    const error = await client.getAccount().catch((reason) => reason);

    expect(error).toBeInstanceOf(ConnectorDataError);
    expect(error).toMatchObject({
      code: 'gmail_account_unavailable',
      operation: 'getAccount',
      provider: 'gmail',
    });
    expect(error.message).not.toMatch(/account-1|EXPIRED|github/);
  });

  it('executes a bounded Gmail search and normalizes nested messages', async () => {
    const execute = vi.fn().mockResolvedValue({
      result: {
        data: {
          messages: [
            {
              id: 'message-1',
              labelIds: ['INBOX'],
              sender: 'Sender <sender@example.com>',
              subject: 'Status',
            },
          ],
        },
      },
      successful: true,
    });
    const client = createGmailConnectorClient({
      composio: { connectedAccounts: { get: vi.fn(), list: vi.fn() }, tools: { execute } },
      connectedAccountId: 'account-1',
      toolVersion: '20250909_00',
      userId: 'user-1',
    });

    await expect(
      client.searchMessages({ maxResults: 10_000, query: 'newer_than:90d' }),
    ).resolves.toEqual([
      {
        id: 'message-1',
        labels: ['INBOX'],
        sender: 'sender@example.com',
        sourceUrl: 'gmail:message:message-1',
        subject: 'Status',
      },
    ]);
    expect(execute).toHaveBeenCalledWith('GMAIL_FETCH_EMAILS', {
      arguments: { max_results: 25, query: 'newer_than:90d' },
      connectedAccountId: 'account-1',
      userId: 'user-1',
      version: '20250909_00',
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'falls back to the safe default for non-finite maxResults %s',
    async (maxResults) => {
      const execute = vi.fn().mockResolvedValue({ data: [], successful: true });
      const client = createGmailConnectorClient({
        composio: { connectedAccounts: { get: vi.fn(), list: vi.fn() }, tools: { execute } },
        connectedAccountId: 'account-1',
        toolVersion: '20250909_00',
        userId: 'user-1',
      });

      await client.searchMessages({ maxResults, query: 'receipt' });

      expect(execute).toHaveBeenCalledWith('GMAIL_FETCH_EMAILS', {
        arguments: { max_results: 25, query: 'receipt' },
        connectedAccountId: 'account-1',
        userId: 'user-1',
        version: '20250909_00',
      });
    },
  );

  it('sanitizes resolved and rejected Composio search failures', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ error: 'token=secret', successful: false })
      .mockRejectedValueOnce(new Error('account-1 token=secret'));
    const client = createGmailConnectorClient({
      composio: { connectedAccounts: { get: vi.fn(), list: vi.fn() }, tools: { execute } },
      connectedAccountId: 'account-1',
      toolVersion: '20250909_00',
      userId: 'user-1',
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const error = await client.searchMessages({ query: 'receipt' }).catch((reason) => reason);
      expect(error).toBeInstanceOf(ConnectorDataError);
      expect(error.message).toBe('gmail searchMessages failed');
      expect(error.message).not.toMatch(/secret|account-1/);
    }
  });

  it.each([
    { data: [] },
    { data: [], successful: 'true' },
    { data: { messages: [{ unexpected: true }] }, successful: true },
    { payload: { unexpected: true }, successful: true },
  ])('rejects malformed Composio search responses', async (response) => {
    const client = createGmailConnectorClient({
      composio: {
        connectedAccounts: { get: vi.fn(), list: vi.fn() },
        tools: { execute: vi.fn().mockResolvedValue(response) },
      },
      connectedAccountId: 'account-1',
      toolVersion: '20250909_00',
      userId: 'user-1',
    });

    await expect(client.searchMessages({ query: 'receipt' })).rejects.toMatchObject({
      operation: 'searchMessages',
      provider: 'gmail',
      retryable: false,
    });
  });

  it('resolves and caches an explicit Composio tool version', async () => {
    const getRawComposioToolBySlug = vi.fn().mockResolvedValue({ version: '20250909_00' });
    const execute = vi.fn().mockResolvedValue({ data: [], successful: true });
    const client = createGmailConnectorClient({
      composio: {
        connectedAccounts: { get: vi.fn(), list: vi.fn() },
        tools: { execute, getRawComposioToolBySlug },
      },
      connectedAccountId: 'account-1',
      userId: 'user-1',
    });

    await client.searchMessages({ query: 'receipt' });
    await client.searchMessages({ query: 'invoice' });

    expect(getRawComposioToolBySlug).toHaveBeenCalledOnce();
    expect(getRawComposioToolBySlug).toHaveBeenCalledWith('GMAIL_FETCH_EMAILS');
    expect(execute).toHaveBeenNthCalledWith(
      2,
      'GMAIL_FETCH_EMAILS',
      expect.objectContaining({ version: '20250909_00' }),
    );
  });
});
