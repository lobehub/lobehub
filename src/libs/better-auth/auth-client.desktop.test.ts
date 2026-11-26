import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  accountInfo,
  changeEmail,
  linkSocial,
  listAccounts,
  signIn,
  unlinkAccount,
} from './auth-client.desktop';

afterEach(() => {
  vi.unstubAllGlobals();
});

const requestUrl = (input: RequestInfo | URL) => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

describe('desktop better-auth client', () => {
  it('uses the 1.7 social endpoints for generic providers and local account IDs', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ status: true }));
    vi.stubGlobal('fetch', fetch);

    await signIn.social({ callbackURL: '/chat', provider: 'custom-oidc' });
    await linkSocial({ callbackURL: '/profile', provider: 'custom-oidc' });
    await accountInfo({ query: { accountId: 'local-account-id' } });
    await unlinkAccount({ accountId: 'local-account-id' });

    expect(fetch.mock.calls.map(([input]) => requestUrl(input))).toEqual([
      '/api/auth/sign-in/social',
      '/api/auth/link-social',
      '/api/auth/account-info?accountId=local-account-id',
      '/api/auth/unlink-account',
    ]);
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({
      provider: 'custom-oidc',
    });
    expect(JSON.parse(fetch.mock.calls[3][1]!.body as string)).toEqual({
      accountId: 'local-account-id',
    });
  });

  it('sends account requests to the renderer instead of the remote server', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ status: true }));
    vi.stubGlobal('fetch', fetch);

    await changeEmail({ callbackURL: '/settings/profile', newEmail: 'new@example.com' });
    await listAccounts();

    expect(fetch.mock.calls.map(([input]) => requestUrl(input))).toEqual([
      '/api/auth/change-email',
      '/api/auth/list-accounts',
    ]);
  });
});
