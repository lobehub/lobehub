import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiErrorSchema } from '../common/errors';
import { rateLimit } from './rate-limit';
import { requestIdMiddleware } from './request-id';

const { hitRateLimit } = vi.hoisted(() => ({ hitRateLimit: vi.fn() }));
vi.mock('@/server/services/redis', () => ({ redisService: { openapi: { hitRateLimit } } }));

const createApp = (auth: { apiKeyId?: number; authType: string | null }) => {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.use('*', async (c, next) => {
    c.set('authType', auth.authType);
    c.set('authData', auth.apiKeyId ? { apiKeyId: auth.apiKeyId } : null);
    await next();
  });
  app.use('*', rateLimit({ bucket: 'test', limit: 2, windowSeconds: 60 }));
  app.get('/', (c) => c.json({ ok: true }));
  app.get('/raw', () => new Response('raw'));
  return app;
};

const resetAt = Math.floor(Date.now() / 1000) + 30;

describe('rateLimit middleware', () => {
  beforeEach(() => {
    hitRateLimit.mockReset();
  });

  it('counts API-key requests per key and reports the window in headers', async () => {
    hitRateLimit.mockResolvedValue({ allowed: true, limit: 2, remaining: 1, resetAt });

    const response = await createApp({ apiKeyId: 7, authType: 'apikey' }).request('/');

    expect(response.status).toBe(200);
    expect(hitRateLimit).toHaveBeenCalledWith({
      bucket: 'test',
      identity: 'key:7',
      limit: 2,
      windowSeconds: 60,
    });
    expect(response.headers.get('X-RateLimit-Limit')).toBe('2');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('1');
    expect(response.headers.get('X-RateLimit-Reset')).toBe(String(resetAt));
  });

  it('refuses past the limit with 429 rate_limited and Retry-After', async () => {
    hitRateLimit.mockResolvedValue({ allowed: false, limit: 2, remaining: 0, resetAt });

    const response = await createApp({ apiKeyId: 7, authType: 'apikey' }).request('/');
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(ApiErrorSchema.parse(body).code).toBe('rate_limited');
    expect(body.requestId).toBe(response.headers.get('X-Request-Id'));
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(Number(response.headers.get('Retry-After'))).toBeLessThanOrEqual(30);
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('keeps the headers on a handler that returns a raw Response', async () => {
    hitRateLimit.mockResolvedValue({ allowed: true, limit: 2, remaining: 1, resetAt });

    const response = await createApp({ apiKeyId: 7, authType: 'apikey' }).request('/raw');

    expect(response.headers.get('X-RateLimit-Limit')).toBe('2');
  });

  it('does not limit requests that are not authenticated by an API key', async () => {
    for (const authType of ['oidc', null]) {
      const response = await createApp({ authType }).request('/');
      expect(response.status).toBe(200);
      expect(response.headers.get('X-RateLimit-Limit')).toBeNull();
    }
    expect(hitRateLimit).not.toHaveBeenCalled();
  });

  it('admits the request when Redis is unavailable or failing', async () => {
    hitRateLimit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('down'));
    const app = createApp({ apiKeyId: 7, authType: 'apikey' });

    expect((await app.request('/')).status).toBe(200);
    expect((await app.request('/')).status).toBe(200);
  });
});
