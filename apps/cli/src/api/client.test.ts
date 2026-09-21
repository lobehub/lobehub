import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateTRPCClient = vi.hoisted(() => vi.fn(() => ({ marker: 'client' })));
const mockHttpLink = vi.hoisted(() => vi.fn((opts: unknown) => opts));

vi.mock('@trpc/client', () => ({
  createTRPCClient: mockCreateTRPCClient,
  httpLink: mockHttpLink,
}));

vi.mock('../auth/refresh', () => ({
  getValidToken: vi.fn(),
}));

vi.mock('../settings', () => ({
  loadActiveWorkspace: () => undefined,
  resolveServerUrl: () => 'https://app.lobehub.com',
}));

const headersOfLastLink = () => {
  const { headers } = mockHttpLink.mock.calls.at(-1)![0] as any;
  return typeof headers === 'function' ? headers() : headers;
};

describe('api/client workspace scoping', () => {
  const originalJwt = process.env.LOBEHUB_JWT;
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
    expect(headersOfLastLink()).toMatchObject({ 'Oidc-Auth': 'env-jwt' });

    process.env.LOBEHUB_JWT = 'renewed-jwt';
    expect(headersOfLastLink()).toMatchObject({ 'Oidc-Auth': 'renewed-jwt' });
  });

  // The tools router is workspace aware like lambda; without the header every
  // `lh search` ran against personal scope and billed the personal budget.
  it('scopes the tools client to the run workspace', async () => {
    process.env.LOBEHUB_WORKSPACE_ID = 'workspace-1';

    const { getToolsTrpcClient } = await import('./client');
    await getToolsTrpcClient();

    expect(headersOfLastLink()).toMatchObject({ 'X-Workspace-Id': 'workspace-1' });
  });

  it('omits the header for the tools client in personal mode', async () => {
    const { getToolsTrpcClient } = await import('./client');
    await getToolsTrpcClient();

    expect(headersOfLastLink()).not.toHaveProperty('X-Workspace-Id');
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
});
