import superjson from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createKeepaliveLambdaClient } from './lambda';

vi.mock('@/const/version', () => ({ isDesktop: false }));
// The shared resolver loads modules on demand; model that with a real delay.
vi.mock('@/services/_auth', () => ({
  createHeaderWithAuth: () => new Promise((resolve) => setTimeout(() => resolve({}), 10)),
}));
vi.mock('@/business/client/trpc-headers', () => ({
  getBusinessTrpcHeaders: async () => ({ 'X-Workspace-Id': 'ws_active' }),
}));

describe('createKeepaliveLambdaClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', new URL('http://localhost/settings/devices/dev-1'));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ result: { data: superjson.serialize({ closed: true }) } }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('starts the keepalive fetch before the page can be torn down', async () => {
    // Regression: closing the browser tab left the device shell running. The
    // request waited on the headers resolver from `pagehide`, so its fetch
    // began after the page was gone and was never sent.
    const client = await createKeepaliveLambdaClient();

    const pending = client.device.closeTerminal.mutate({ deviceId: 'dev-1', id: 'term_1' });
    // Only microtasks run before the browser unloads the page; no timer does.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/trpc/lambda/device.closeTerminal');
    expect(init).toMatchObject({ keepalive: true, method: 'POST' });
    expect(init.headers).toMatchObject({ 'X-Workspace-Id': 'ws_active' });
    await pending;
  });

  it('pins a personal scope by dropping the workspace header', async () => {
    const client = await createKeepaliveLambdaClient(null);
    await client.device.closeTerminal.mutate({ deviceId: 'dev-1', id: 'term_1' });

    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-Workspace-Id');
  });
});
