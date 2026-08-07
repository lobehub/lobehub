import { describe, expect, it, vi } from 'vitest';

import { ConnectorDataError } from '../errors';
import { loadGmailAccount } from './account';

const loadAccount = (list: ReturnType<typeof vi.fn>, get = vi.fn()) =>
  loadGmailAccount({
    connectedAccountId: 'account-1',
    connectedAccounts: { get, list },
    userId: 'user-1',
  });

describe('loadGmailAccount', () => {
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

    await expect(loadAccount(list, get)).resolves.toEqual({
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

  it('follows ownership pages and loads missing account details', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ items: [], nextCursor: 'page-2', totalPages: 9 })
      .mockResolvedValueOnce({
        items: [{ id: 'account-1', status: 'ACTIVE', toolkit: { slug: 'gmail' } }],
        totalPages: 9,
      });
    const get = vi.fn().mockResolvedValue({
      data: { email: 'detail@example.com', scope: 'openid,gmail.readonly' },
      id: 'account-1',
      status: 'ACTIVE',
      toolkit: { slug: 'gmail' },
    });

    await expect(loadAccount(list, get)).resolves.toEqual({
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

  it('reads OAuth2 metadata without enumerating credentials or unrelated fields', async () => {
    let accessTokenRead = false;
    const account = {
      id: 'account-1',
      state: {
        authScheme: 'OAUTH2',
        val: {
          email: 'sdk@example.com',
          scope: 'openid gmail.readonly',
          status: 'ACTIVE',
          get access_token(): never {
            accessTokenRead = true;
            throw new Error('access token must not be read');
          },
        },
      },
      toolkit: { slug: 'gmail' },
      get unrelated(): never {
        throw new Error('unrelated account field accessed');
      },
    };
    const list = vi.fn().mockResolvedValue({
      items: [account],
      totalPages: 1,
      get unrelated(): never {
        throw new Error('unrelated response field accessed');
      },
    });

    await expect(loadAccount(list)).resolves.toEqual({
      email: 'sdk@example.com',
      externalAccountId: 'account-1',
      scopes: ['gmail.readonly', 'openid'],
    });
    expect(accessTokenRead).toBe(false);
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
  ])(
    'merges partially populated list and detail accounts',
    async ({ detailData, expected, listData }) => {
      const list = vi.fn().mockResolvedValue({
        items: [{ data: listData, id: 'account-1', status: 'ACTIVE', toolkit: { slug: 'gmail' } }],
        totalPages: 1,
      });
      const get = vi.fn().mockResolvedValue({
        data: detailData,
        id: 'account-1',
        status: 'ACTIVE',
        toolkit: { slug: 'gmail' },
      });

      await expect(loadAccount(list, get)).resolves.toMatchObject({
        externalAccountId: 'account-1',
        ...expected,
      });
    },
  );

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

    await expect(
      loadAccount(vi.fn().mockResolvedValue({ items: proxiedItems, totalPages: 1 })),
    ).rejects.toBeInstanceOf(ConnectorDataError);
    expect(accessedBeyondBound).toBe(false);
  });

  it.each([
    { id: 'account-1', status: 'EXPIRED', toolkit: { slug: 'gmail' } },
    { id: 'account-1', status: 'ACTIVE', toolkit: { slug: 'github' } },
    { id: 'account-1', isDisabled: true, status: 'ACTIVE', toolkit: { slug: 'gmail' } },
  ])('rejects inactive, disabled, or non-Gmail accounts', async (account) => {
    const error = await loadAccount(
      vi.fn().mockResolvedValue({ items: [account], totalPages: 1 }),
    ).catch((reason) => reason);

    expect(error).toBeInstanceOf(ConnectorDataError);
    expect(error).toMatchObject({
      code: 'gmail_account_unavailable',
      operation: 'getAccount',
      provider: 'gmail',
    });
    expect(error.message).not.toMatch(/account-1|EXPIRED|github/);
  });
});
