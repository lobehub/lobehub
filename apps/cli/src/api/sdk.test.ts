import { LobeHubAPIError } from '@lobehub/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RefreshModule from '../auth/refresh';
import { getValidToken } from '../auth/refresh';
import { __resetSdkClients, getSdkClient } from './sdk';

vi.mock('../auth/refresh', async (importOriginal) => ({
  ...(await importOriginal<typeof RefreshModule>()),
  getValidToken: vi.fn(),
}));
vi.mock('../auth/credentials', () => ({ loadCredentials: () => undefined }));
vi.mock('../settings', () => ({
  loadActiveWorkspace: () => undefined,
  resolveServerUrl: () => 'https://app.lobehub.com',
}));
vi.mock('../utils/logger', () => ({ log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const jwt = (payload: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

const storedToken = jwt({ sub: 'user-1' });
const ENV_KEYS = ['LOBEHUB_JWT', 'LOBEHUB_CLI_API_KEY', 'LOBEHUB_API_KEY', 'LOBEHUB_WORKSPACE_ID'];

describe('getSdkClient', () => {
  const fetchMock = vi.fn();
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  const sent = (call = 0) => fetchMock.mock.calls[call][0] as Request;

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    __resetSdkClients();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: { id: 'user-1' }, success: true }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.mocked(getValidToken).mockResolvedValue({
      credentials: { accessToken: storedToken },
      status: 'ok',
    } as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('sends the stored OIDC login as a Bearer token to /api/v1', async () => {
    const sdk = await getSdkClient();
    await sdk.users.me();

    expect(sent().url).toBe('https://app.lobehub.com/api/v1/users/me');
    expect(sent().headers.get('Authorization')).toBe(`Bearer ${storedToken}`);
    expect(sent().headers.has('X-Workspace-Id')).toBe(false);
  });

  it('re-reads the stored login for every request so refreshed tokens are used', async () => {
    const sdk = await getSdkClient();
    await sdk.users.me();
    const refreshed = jwt({ sub: 'user-1', v: 2 });
    vi.mocked(getValidToken).mockResolvedValue({
      credentials: { accessToken: refreshed },
      status: 'ok',
    } as any);
    await sdk.users.me();

    expect(sent(1).headers.get('Authorization')).toBe(`Bearer ${refreshed}`);
  });

  it('sends an API key from LOBEHUB_CLI_API_KEY', async () => {
    process.env.LOBEHUB_CLI_API_KEY = 'sk-lh-abcdefghijklmnop';
    const sdk = await getSdkClient();
    await sdk.users.me();

    expect(sent().headers.get('Authorization')).toBe('Bearer sk-lh-abcdefghijklmnop');
    expect(getValidToken).not.toHaveBeenCalled();
  });

  it('scopes requests with X-Workspace-Id from LOBEHUB_WORKSPACE_ID or the explicit id', async () => {
    process.env.LOBEHUB_WORKSPACE_ID = 'ws_env';
    await (await getSdkClient()).users.me();
    await (await getSdkClient('ws_explicit')).users.me();

    expect(sent(0).headers.get('X-Workspace-Id')).toBe('ws_env');
    expect(sent(1).headers.get('X-Workspace-Id')).toBe('ws_explicit');
  });

  it('swaps a hetero-operation LOBEHUB_JWT for the stored login of the same account', async () => {
    process.env.LOBEHUB_JWT = jwt({ purpose: 'hetero-operation', sub: 'user-1' });
    await (await getSdkClient()).users.me();

    expect(sent().headers.get('Authorization')).toBe(`Bearer ${storedToken}`);
  });

  it('refuses to borrow another account’s stored login for an operation token', async () => {
    process.env.LOBEHUB_JWT = jwt({ purpose: 'hetero-operation', sub: 'someone-else' });
    const sdk = await getSdkClient();

    await expect(sdk.users.me()).rejects.toThrow(/operation token/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a plain LOBEHUB_JWT as is', async () => {
    const envJwt = jwt({ sub: 'sandbox-user' });
    process.env.LOBEHUB_JWT = envJwt;
    await (await getSdkClient()).users.me();

    expect(sent().headers.get('Authorization')).toBe(`Bearer ${envJwt}`);
  });

  it('rejects an error answer with a LobeHubAPIError carrying the server code', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ code: 'not_found', message: 'Agent not found', success: false }),
          { headers: { 'Content-Type': 'application/json' }, status: 404 },
        ),
    );
    const sdk = await getSdkClient();

    const error = await sdk.agents.get({ path: { id: 'agt_x' } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LobeHubAPIError);
    expect(error).toMatchObject({ code: 'not_found', message: 'Agent not found', status: 404 });
  });
});
