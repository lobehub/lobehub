import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RefreshModule from '../auth/refresh';
import { getValidToken } from '../auth/refresh';
import { getOpenApi } from './openapi';

vi.mock('../auth/refresh', async (importOriginal) => ({
  ...(await importOriginal<typeof RefreshModule>()),
  getValidToken: vi.fn(),
}));
vi.mock('../settings', () => ({
  loadActiveWorkspace: () => undefined,
  resolveServerUrl: () => 'https://app.lobehub.com',
}));
vi.mock('../utils/logger', () => ({ log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const jwt = (payload: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

const storedToken = jwt({ sub: 'user-1' });

describe('getOpenApi', () => {
  const fetchMock = vi.fn();
  const originalJwt = process.env.LOBEHUB_JWT;
  const originalWorkspaceId = process.env.LOBEHUB_WORKSPACE_ID;

  const sentHeaders = () => fetchMock.mock.calls[0][1].headers as Record<string, string>;

  beforeEach(() => {
    delete process.env.LOBEHUB_JWT;
    delete process.env.LOBEHUB_WORKSPACE_ID;
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { quota: null }, success: true })),
    );
    vi.mocked(getValidToken).mockResolvedValue({
      credentials: { accessToken: storedToken },
      status: 'ok',
    } as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalJwt === undefined) delete process.env.LOBEHUB_JWT;
    else process.env.LOBEHUB_JWT = originalJwt;
    if (originalWorkspaceId === undefined) delete process.env.LOBEHUB_WORKSPACE_ID;
    else process.env.LOBEHUB_WORKSPACE_ID = originalWorkspaceId;
  });

  it('sends the stored login as a Bearer token and unwraps data', async () => {
    await expect(getOpenApi('/usage', 'ws-1')).resolves.toEqual({ quota: null });

    expect(fetchMock.mock.calls[0][0]).toBe('https://app.lobehub.com/api/v1/usage');
    expect(sentHeaders()).toEqual({
      'Authorization': `Bearer ${storedToken}`,
      'X-Workspace-Id': 'ws-1',
    });
  });

  it("replaces a run's operation token with the same account's stored login", async () => {
    process.env.LOBEHUB_JWT = jwt({ purpose: 'hetero-operation', sub: 'user-1' });

    await getOpenApi('/usage');

    expect(sentHeaders().Authorization).toBe(`Bearer ${storedToken}`);
  });

  it('keeps a regular JWT from the environment', async () => {
    const envToken = jwt({ sub: 'user-2' });
    process.env.LOBEHUB_JWT = envToken;

    await getOpenApi('/usage');

    expect(sentHeaders().Authorization).toBe(`Bearer ${envToken}`);
  });

  it("throws the server's error message", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not a member of this workspace', success: false }), {
        status: 403,
      }),
    );

    await expect(getOpenApi('/usage', 'ws-1')).rejects.toThrow('Not a member of this workspace');
  });
});
