import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { REQUEST_ID_HEADER, requestIdMiddleware } from './request-id';

const createApp = () => {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.get('/', (c) => c.json({ requestId: c.get('requestId') }));
  app.get('/raw', () => new Response('raw'));
  app.get('/frozen', async () => {
    const upstream = await fetch('data:text/plain,frozen');
    return upstream;
  });
  return app;
};

describe('requestIdMiddleware', () => {
  it('assigns an id, exposes it in the context and echoes it in the header', async () => {
    const response = await createApp().request('/');
    const { requestId } = await response.json();

    expect(requestId).toMatch(/^req_[\da-f]{32}$/);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(requestId);
  });

  it('keeps a well-formed client id and replaces a malformed one', async () => {
    const app = createApp();

    const kept = await app.request('/', { headers: { [REQUEST_ID_HEADER]: 'client-123.a:b' } });
    expect(kept.headers.get(REQUEST_ID_HEADER)).toBe('client-123.a:b');

    const replaced = await app.request('/', { headers: { [REQUEST_ID_HEADER]: 'bad id\n' } });
    expect(replaced.headers.get(REQUEST_ID_HEADER)).toMatch(/^req_/);
  });

  it('sets the header on raw and immutable responses too', async () => {
    const app = createApp();
    expect((await app.request('/raw')).headers.get(REQUEST_ID_HEADER)).toMatch(/^req_/);
    expect((await app.request('/frozen')).headers.get(REQUEST_ID_HEADER)).toMatch(/^req_/);
  });
});
