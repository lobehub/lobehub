import type { Operation } from '@trpc/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RefreshModule from '../auth/refresh';

const mockCreateTRPCClient = vi.hoisted(() => vi.fn(() => ({ marker: 'client' })));
const mockHttpLink = vi.hoisted(() => vi.fn((opts: unknown) => opts));

vi.mock('@trpc/client', () => ({
  createTRPCClient: mockCreateTRPCClient,
  httpLink: mockHttpLink,
}));

vi.mock('../auth/refresh', async (importOriginal) => ({
  ...(await importOriginal<typeof RefreshModule>()),
  getValidToken: vi.fn(),
}));

vi.mock('../settings', () => ({
  loadActiveWorkspace: () => undefined,
  resolveServerUrl: () => 'https://app.lobehub.com',
}));

const headersOfLastLink = (opts?: { op: Operation }) => {
  const { headers } = mockHttpLink.mock.calls.at(-1)![0] as any;
  return typeof headers === 'function' ? headers(opts) : headers;
};

describe('api/client workspace scoping', () => {
  const originalJwt = process.env.LOBEHUB_JWT;
  const originalApiKey = process.env.LOBEHUB_CLI_API_KEY;
  const originalWorkspaceId = process.env.LOBEHUB_WORKSPACE_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.LOBEHUB_JWT = 'env-jwt';
    delete process.env.LOBEHUB_WORKSPACE_ID;
  });

  afterEach(() => {
    if (originalJwt === undefined) delete process.env.LOBEHUB_JWT;
    else process.env.LOBEHUB_JWT = originalJwt;

    if (originalApiKey === undefined) delete process.env.LOBEHUB_CLI_API_KEY;
    else process.env.LOBEHUB_CLI_API_KEY = originalApiKey;

    if (originalWorkspaceId === undefined) delete process.env.LOBEHUB_WORKSPACE_ID;
    else process.env.LOBEHUB_WORKSPACE_ID = originalWorkspaceId;
  });

  /**
   * Regression: the env JWT was copied into the link once, when the client was
   * built. `lh hetero exec` holds its client for the whole run, so a renewed
   * operation token never reached it and every request after the original
   * token's four hours was rejected.
   */
  it('sends a renewed LOBEHUB_JWT on requests from an existing client', async () => {
    const { getTrpcClient } = await import('./client');
    await getTrpcClient();
    expect(await headersOfLastLink()).toMatchObject({ 'Oidc-Auth': 'env-jwt' });

    process.env.LOBEHUB_JWT = 'renewed-jwt';
    expect(await headersOfLastLink()).toMatchObject({ 'Oidc-Auth': 'renewed-jwt' });
  });

  it('refreshes stored-login credentials for journal reads on a cached client', async () => {
    delete process.env.LOBEHUB_JWT;
    delete process.env.LOBEHUB_CLI_API_KEY;
    const { getValidToken } = await import('../auth/refresh');
    vi.mocked(getValidToken).mockResolvedValue({
      credentials: { accessToken: 'original-token' },
      status: 'ok',
    });
    const { getTrpcClient } = await import('./client');
    const client = await getTrpcClient('workspace-1');
    expect(await headersOfLastLink()).toMatchObject({
      'Oidc-Auth': 'original-token',
      'X-Workspace-Id': 'workspace-1',
    });

    vi.mocked(getValidToken).mockResolvedValue({
      credentials: { accessToken: 'renewed-token' },
      status: 'ok',
    });
    expect(await getTrpcClient('workspace-1')).toBe(client);
    expect(await headersOfLastLink()).toMatchObject({
      'Oidc-Auth': 'renewed-token',
      'X-Workspace-Id': 'workspace-1',
    });
  });

  it('creates an anonymous Lambda client without resolving credentials or workspace headers', async () => {
    delete process.env.LOBEHUB_JWT;
    process.env.LOBEHUB_WORKSPACE_ID = 'workspace-1';
    const { getValidToken } = await import('../auth/refresh');
    const { createPublicLambdaClient } = await import('./client');

    createPublicLambdaClient();

    expect(getValidToken).not.toHaveBeenCalled();
    expect(mockHttpLink).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://app.lobehub.com/trpc/lambda' }),
    );
    expect(headersOfLastLink()).toBeUndefined();
  });

  it('does not attach an environment credential to public downloads', async () => {
    const { createPublicLambdaClient } = await import('./client');

    createPublicLambdaClient();

    expect(headersOfLastLink()).toBeUndefined();
  });

  // The tools router is workspace aware like lambda; without the header every
  // `lh search` ran against personal scope and billed the personal budget.
  it('scopes the tools client to the run workspace', async () => {
    process.env.LOBEHUB_WORKSPACE_ID = 'workspace-1';

    const { getToolsTrpcClient } = await import('./client');
    await getToolsTrpcClient();

    expect(await headersOfLastLink()).toMatchObject({ 'X-Workspace-Id': 'workspace-1' });
  });

  it('omits the header for the tools client in personal mode', async () => {
    const { getToolsTrpcClient } = await import('./client');
    await getToolsTrpcClient();

    expect(await headersOfLastLink()).not.toHaveProperty('X-Workspace-Id');
  });

  it('caches tools clients per workspace instead of returning the first one forever', async () => {
    const { getToolsTrpcClient } = await import('./client');

    const personal = await getToolsTrpcClient();
    const scoped = await getToolsTrpcClient('workspace-1');
    const scopedAgain = await getToolsTrpcClient('workspace-1');

    expect(mockCreateTRPCClient).toHaveBeenCalledTimes(2);
    expect(scoped).toBe(scopedAgain);
    expect(scoped).not.toBe(personal);
  });

  it.each(['getTrpcClient', 'getToolsTrpcClient'] as const)(
    '%s preserves per-request fallback credentials and the run workspace',
    async (clientFactory) => {
      process.env.LOBEHUB_JWT = `e30.${Buffer.from(
        JSON.stringify({ purpose: 'hetero-operation', sub: 'user-1' }),
      ).toString('base64url')}.s`;
      process.env.LOBEHUB_WORKSPACE_ID = 'workspace-1';
      const clients = await import('./client');
      await clients[clientFactory]();

      expect(
        await headersOfLastLink({
          op: {
            context: { storedLogin: 'same-user-login' },
            id: 1,
            input: undefined,
            path: 'doc.list',
            type: 'query',
          },
        }),
      ).toEqual({ 'Oidc-Auth': 'same-user-login', 'X-Workspace-Id': 'workspace-1' });
      expect(await headersOfLastLink()).toEqual({
        'Oidc-Auth': process.env.LOBEHUB_JWT,
        'X-Workspace-Id': 'workspace-1',
      });
    },
  );

  // Only a device run's operation token is refused on user-scoped routes, so
  // only its clients get the stored-login fallback (see operationTokenFallback).
  it.each([
    ['an operation token', { purpose: 'hetero-operation', sub: 'user-1' }, 2],
    ['a user-scoped token', { purpose: 'cli-sandbox', sub: 'user-1' }, 1],
  ])('builds the fallback link only for %s', async (_label, payload, linkCount) => {
    process.env.LOBEHUB_JWT = `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
    const { getTrpcClient } = await import('./client');
    await getTrpcClient();

    const { links } = (mockCreateTRPCClient.mock.calls.at(-1) as any[])[0];
    expect(links).toHaveLength(linkCount);
    expect(await headersOfLastLink()).toMatchObject({ 'Oidc-Auth': process.env.LOBEHUB_JWT });
  });
});
