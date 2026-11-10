// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { revokeLinearToken } from '../client';

vi.mock('@/envs/linear', () => ({
  linearEnv: { ENABLED_LINEAR: true, LINEAR_CLIENT_ID: 'client', LINEAR_CLIENT_SECRET: 'secret' },
}));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.example.com' } }));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const authorization = (call: unknown[]) =>
  (call[1] as RequestInit).headers as Record<string, string>;

describe('revokeLinearToken', () => {
  it('revokes a live access token directly', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));

    const ok = await revokeLinearToken(
      { accessToken: 'live', refreshToken: 'refresh' },
      new Date(Date.now() + 60_000),
    );

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.linear.app/oauth/revoke');
    expect(authorization(fetchMock.mock.calls[0])).toEqual({ Authorization: 'Bearer live' });
  });

  it('refreshes an expired access token before revoking it', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ access_token: 'fresh', expires_in: 86_399, refresh_token: 'next' }),
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    const ok = await revokeLinearToken(
      { accessToken: 'stale', refreshToken: 'refresh' },
      new Date(Date.now() - 1000),
    );

    expect(ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.linear.app/oauth/token');
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh');
    expect(authorization(fetchMock.mock.calls[1])).toEqual({ Authorization: 'Bearer fresh' });
  });

  it('reports a revocation Linear rejected', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Token not found' }, { status: 401 }));

    await expect(revokeLinearToken({ accessToken: 'gone' })).resolves.toBe(false);
  });

  it('reports a network failure instead of throwing', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    await expect(revokeLinearToken({ accessToken: 'token' })).resolves.toBe(false);
  });
});
