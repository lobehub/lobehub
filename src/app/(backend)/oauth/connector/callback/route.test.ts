import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const { mockConsume, mockFindById, mockSync, mockUpdate } = vi.hoisted(() => ({
  mockConsume: vi.fn(),
  mockFindById: vi.fn(),
  mockSync: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('@/database/server', () => ({ serverDB: {} }));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.example.com' } }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn().mockResolvedValue({}) },
}));
vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  discoverAuthorizationServerMetadata: vi
    .fn()
    .mockResolvedValue({ token_endpoint: 'https://as/token' }),
}));
vi.mock('@/server/services/connector/oauth', () => ({
  exchangeConnectorCode: vi.fn().mockResolvedValue({ access_token: 'tok' }),
}));
vi.mock('@/server/services/connector/tokens', () => ({
  tokensToCredentials: vi
    .fn()
    .mockReturnValue({ credentials: { accessToken: 'tok', type: 'oauth2' }, tokenExpiresAt: null }),
}));
vi.mock('@/server/services/connector/stateStore', () => ({
  consumeConnectorOAuthState: mockConsume,
}));
vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi
    .fn()
    .mockImplementation(() => ({ findById: mockFindById, update: mockUpdate })),
}));
vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/services/connector/sync', () => ({ syncConnectorToolsById: mockSync }));

const makeReq = () =>
  ({ nextUrl: { searchParams: new URLSearchParams('code=abc&state=xyz') } }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockConsume.mockResolvedValue({
    authorizationServerUrl: 'https://as',
    codeVerifier: 'v',
    connectorId: 'c1',
    lobeUserId: 'u1',
  });
  mockFindById.mockResolvedValue({
    id: 'c1',
    mcpServerUrl: 'https://mcp.example.com',
    oidcConfig: {
      clientId: 'cid',
      redirectUri: 'https://app.example.com/oauth/connector/callback',
    },
  });
  mockUpdate.mockResolvedValue(undefined);
});

describe('connector OAuth callback', () => {
  it('reports synced:false when auth succeeds but tool sync fails', async () => {
    mockSync.mockRejectedValue(new Error('mcp down'));

    const body = await (await GET(makeReq())).text();

    expect(body).toContain('"success":true');
    expect(body).toContain('"synced":false');
  });

  it('reports synced:true when auth and tool sync both succeed', async () => {
    mockSync.mockResolvedValue({ toolCount: 5 });

    const body = await (await GET(makeReq())).text();

    expect(body).toContain('"success":true');
    expect(body).toContain('"synced":true');
  });
});
