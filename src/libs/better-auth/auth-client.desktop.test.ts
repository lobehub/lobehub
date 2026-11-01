import { afterEach, describe, expect, it, vi } from 'vitest';

import { changeEmail, listAccounts } from './auth-client.desktop';

afterEach(() => {
  vi.unstubAllGlobals();
});

const requestUrl = (input: RequestInfo | URL) => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

describe('desktop better-auth client', () => {
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
