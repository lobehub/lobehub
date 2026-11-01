import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RefreshModule from '../auth/refresh';

const mockGetValidToken = vi.hoisted(() => vi.fn());
const mockResolveServerUrl = vi.hoisted(() => vi.fn(() => 'https://app.lobehub.com'));

vi.mock('../auth/refresh', async (importOriginal) => ({
  ...(await importOriginal<typeof RefreshModule>()),
  getValidToken: mockGetValidToken,
}));

vi.mock('../settings', () => ({
  loadActiveWorkspace: () => undefined,
  resolveServerUrl: mockResolveServerUrl,
}));

describe('api/http auth helpers', () => {
  const originalJwt = process.env.LOBEHUB_JWT;
  const originalWorkspaceId = process.env.LOBEHUB_WORKSPACE_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LOBEHUB_JWT;
    delete process.env.LOBEHUB_WORKSPACE_ID;
  });

  afterEach(() => {
    if (originalJwt === undefined) delete process.env.LOBEHUB_JWT;
    else process.env.LOBEHUB_JWT = originalJwt;

    if (originalWorkspaceId === undefined) delete process.env.LOBEHUB_WORKSPACE_ID;
    else process.env.LOBEHUB_WORKSPACE_ID = originalWorkspaceId;
  });

  it('should use env JWT and workspace scope for webapi auth', async () => {
    process.env.LOBEHUB_JWT = 'env-jwt';
    process.env.LOBEHUB_WORKSPACE_ID = 'workspace-1';

    const { getAuthInfo } = await import('./http');
    const result = await getAuthInfo();

    expect(result).toEqual({
      accessToken: 'env-jwt',
      headers: {
        'Content-Type': 'application/json',
        'Oidc-Auth': 'env-jwt',
        'X-Workspace-Id': 'workspace-1',
      },
      serverUrl: 'https://app.lobehub.com',
    });
    expect(mockGetValidToken).not.toHaveBeenCalled();
  });

  it('should add workspace scope when using stored OIDC credentials for webapi auth', async () => {
    process.env.LOBEHUB_WORKSPACE_ID = 'workspace-1';
    mockGetValidToken.mockResolvedValue({
      credentials: { accessToken: 'stored-jwt' },
      status: 'ok',
    });

    const { getAuthInfo } = await import('./http');
    const result = await getAuthInfo();

    expect(result.headers).toMatchObject({
      'Oidc-Auth': 'stored-jwt',
      'X-Workspace-Id': 'workspace-1',
    });
  });

  it('should add workspace scope to agent stream auth headers', async () => {
    process.env.LOBEHUB_JWT = 'env-jwt';
    process.env.LOBEHUB_WORKSPACE_ID = 'workspace-1';

    const { getAgentStreamAuthInfo } = await import('./http');
    const result = await getAgentStreamAuthInfo();

    expect(result.headers).toEqual({
      'Oidc-Auth': 'env-jwt',
      'X-Workspace-Id': 'workspace-1',
    });
  });

  /**
   * A reconnect must not end the process: the journal and the status endpoint may still accept the
   * current access token, and the command's polling fallback only runs if this rejects.
   */
  it('should throw instead of exiting when a reconnect resolves no credential', async () => {
    mockGetValidToken.mockResolvedValue({ status: 'no-login' });
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit must not run on a reconnect');
    }) as unknown as typeof process.exit);

    const { resolveAgentStreamAuthInfo } = await import('./http');

    await expect(resolveAgentStreamAuthInfo()).rejects.toThrow(/No authentication found/);
    expect(exit).not.toHaveBeenCalled();

    exit.mockRestore();
  });
});
