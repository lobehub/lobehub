import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { personalConnectorCallback } from './callback';

describe('native connector callback', () => {
  const id = '41aab692-ab9f-48bb-995a-ded40b6fd270';
  const session = '91aab692-ab9f-48bb-995a-ded40b6fd270';
  it('only returns the bound opaque operation to the fixed application callback', async () => {
    const find = vi.fn(async () => ({ id, session, expiresAt: Date.now() + 60000 }));
    const app = new Hono().get('/callback', personalConnectorCallback(find));
    const res = await app.request(
      `/callback?connectionId=${id}&session=${session}&redirect_uri=https://evil.example&token=secret&status=success`,
    );
    const target = new URL(res.headers.get('location')!);
    expect(target.origin + target.pathname).toBe('https://lobehub.com/oidc/callback/toby');
    expect([...target.searchParams.keys()].sort()).toEqual(['connectionId', 'session']);
    expect(find).toHaveBeenCalledWith(id, session);
  });
  it('rejects expired or mismatched callbacks without a success redirect', async () => {
    const app = new Hono().get(
      '/callback',
      personalConnectorCallback(async () => ({ id, session: 'other', expiresAt: Date.now() - 1 })),
    );
    expect((await app.request(`/callback?connectionId=${id}&session=${session}`)).status).toBe(400);
    expect((await app.request('/callback?session=unknown')).status).toBe(400);
  });
});
