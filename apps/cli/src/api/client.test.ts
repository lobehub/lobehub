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

const headersOfLastLink = () => (mockHttpLink.mock.calls.at(-1)![0] as any).headers;

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
