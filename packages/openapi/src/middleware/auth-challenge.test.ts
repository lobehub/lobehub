import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.lobehub.com' } }));

const { authChallenge, WWW_AUTHENTICATE_HEADER } = await import('./auth-challenge');

const CHALLENGE =
  'Bearer realm="LobeHub API", resource_metadata="https://app.lobehub.com/.well-known/oauth-protected-resource/api/v1"';

const createApp = () => {
  const app = new Hono();
  app.use('*', authChallenge);
  app.onError((error, c) =>
    error instanceof HTTPException
      ? c.json({ code: 'unauthorized' }, error.status)
      : c.json({ code: 'internal' }, 500),
  );
  app.get('/thrown', () => {
    throw new HTTPException(401, { message: 'Authentication required' });
  });
  app.get('/returned', (c) => c.json({ code: 'unauthorized' }, 401));
  app.get('/proxied', async () => {
    const upstream = await fetch('data:application/json,{}');
    return new Response(upstream.body, { headers: upstream.headers, status: 401 });
  });
  app.get('/own-challenge', (c) =>
    c.json({}, 401, { [WWW_AUTHENTICATE_HEADER]: 'Payment realm="x"' }),
  );
  app.get('/forbidden', (c) => c.json({ code: 'forbidden' }, 403));
  return app;
};

describe('authChallenge', () => {
  it('points a 401 thrown by auth middleware at the protected resource metadata', async () => {
    const response = await createApp().request('/thrown');

    expect(response.status).toBe(401);
    expect(response.headers.get(WWW_AUTHENTICATE_HEADER)).toBe(CHALLENGE);
  });

  it('covers a 401 a handler returns and a proxied response with fixed headers', async () => {
    const app = createApp();

    expect((await app.request('/returned')).headers.get(WWW_AUTHENTICATE_HEADER)).toBe(CHALLENGE);
    expect((await app.request('/proxied')).headers.get(WWW_AUTHENTICATE_HEADER)).toBe(CHALLENGE);
  });

  it('keeps a challenge the route set and leaves other statuses alone', async () => {
    const app = createApp();

    expect((await app.request('/own-challenge')).headers.get(WWW_AUTHENTICATE_HEADER)).toBe(
      'Payment realm="x"',
    );
    expect((await app.request('/forbidden')).headers.get(WWW_AUTHENTICATE_HEADER)).toBeNull();
  });
});
