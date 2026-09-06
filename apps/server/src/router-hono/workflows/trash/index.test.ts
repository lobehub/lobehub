// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from './index';

const mocks = vi.hoisted(() => ({
  purge: vi.fn((c: { json: (body: unknown, status: number) => Response }) =>
    c.json({ success: true }, 202),
  ),
  qstashAuth: vi.fn(() => async (c: any, next: () => Promise<void>) => {
    if (c.req.header('x-test-qstash-signature') !== 'valid') {
      return c.json({ error: 'Invalid signature' }, 401);
    }
    await next();
  }),
}));

vi.mock('../middlewares/qstashAuth', () => ({ qstashAuth: mocks.qstashAuth }));
vi.mock('./handlers/purge', () => ({ purge: mocks.purge }));

describe('trash workflow routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubEnv('KEY_VAULTS_SECRET', 'local-secret');
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', 'qstash-key');
  });

  it('accepts a Vercel cron request with the configured bearer secret', async () => {
    const response = await app.request('/purge', {
      headers: { authorization: 'Bearer cron-secret' },
      method: 'GET',
    });

    expect(response.status).toBe(202);
    expect(mocks.purge).toHaveBeenCalledOnce();
  });

  it('accepts a local continuation with the configured bearer secret', async () => {
    const response = await app.request('/purge/local', {
      headers: { authorization: 'Bearer local-secret' },
      method: 'POST',
    });

    expect(response.status).toBe(202);
    expect(mocks.purge).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing', undefined],
    ['incorrect', 'Bearer wrong-secret'],
  ])('rejects a local continuation with %s authorization', async (_label, authorization) => {
    const response = await app.request('/purge/local', {
      headers: authorization ? { authorization } : undefined,
      method: 'POST',
    });

    expect(response.status).toBe(401);
    expect(mocks.purge).not.toHaveBeenCalled();
  });

  it('fails closed when the local continuation secret is unset', async () => {
    vi.stubEnv('KEY_VAULTS_SECRET', '');

    const response = await app.request('/purge/local', {
      headers: { authorization: 'Bearer local-secret' },
      method: 'POST',
    });

    expect(response.status).toBe(503);
    expect(mocks.purge).not.toHaveBeenCalled();
  });

  it('keeps the public purge route behind QStash authentication', async () => {
    const unsigned = await app.request('/purge', {
      headers: { authorization: 'Bearer local-secret' },
      method: 'POST',
    });
    expect(unsigned.status).toBe(401);

    const signed = await app.request('/purge', {
      headers: { 'x-test-qstash-signature': 'valid' },
      method: 'POST',
    });
    expect(signed.status).toBe(202);
    expect(mocks.purge).toHaveBeenCalledOnce();
  });

  it('requires the cron bearer secret when QStash verification is unavailable', async () => {
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', '');

    const unauthorized = await app.request('/purge', { method: 'POST' });
    const authorized = await app.request('/purge', {
      headers: { authorization: 'Bearer cron-secret' },
      method: 'POST',
    });

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(202);
    expect(mocks.purge).toHaveBeenCalledOnce();
    expect(mocks.qstashAuth).not.toHaveBeenCalled();
  });

  it('fails closed when QStash verification and the cron secret are both unavailable', async () => {
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', '');
    vi.stubEnv('CRON_SECRET', '');

    const response = await app.request('/purge', { method: 'POST' });

    expect(response.status).toBe(503);
    expect(mocks.purge).not.toHaveBeenCalled();
    expect(mocks.qstashAuth).not.toHaveBeenCalled();
  });
});
