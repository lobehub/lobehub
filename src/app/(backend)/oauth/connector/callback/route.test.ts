import { runInNewContext } from 'node:vm';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';

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
  ConnectorModel: vi.fn(function () {
    return { findById: mockFindById, update: mockUpdate };
  }),
}));
vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: vi.fn(function () {}),
}));
vi.mock('@/server/services/connector/sync', () => ({ syncConnectorToolsById: mockSync }));

const makeReq = (query = 'code=abc&state=xyz') =>
  ({ nextUrl: { searchParams: new URLSearchParams(query) } }) as any;

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
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('connector OAuth callback', () => {
  it.each([true, false])(
    'delivers status with or without an opener (opener=%s)',
    async (hasOpener) => {
      mockSync.mockResolvedValue({ toolCount: 5 });
      const body = await (await GET(makeReq())).text();
      const postMessage = vi.fn();
      const openerPostMessage = vi.fn();
      const script = new DOMParser().parseFromString(body, 'text/html').querySelector('script');
      if (!script?.textContent) throw new Error('Missing callback status script');

      runInNewContext(script.textContent, {
        setTimeout: vi.fn(),
        window: {
          location: { origin: 'https://app.example.com' },
          opener: hasOpener ? { postMessage: openerPostMessage } : null,
          postMessage,
        },
      });

      const expected = {
        connectorId: 'c1',
        success: true,
        synced: true,
        type: 'lobe-connector-oauth',
      };
      expect(postMessage.mock.calls).toEqual([[expected, 'https://app.example.com']]);
      expect(openerPostMessage.mock.calls).toEqual(
        hasOpener ? [[expected, 'https://app.example.com']] : [],
      );
    },
  );

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

  it('looks the connector up in the workspace it was started from', async () => {
    mockSync.mockResolvedValue({ toolCount: 5 });
    mockConsume.mockResolvedValue({
      authorizationServerUrl: 'https://as',
      codeVerifier: 'v',
      connectorId: 'c1',
      lobeUserId: 'u1',
      workspaceId: 'ws1',
    });

    const body = await (await GET(makeReq())).text();

    expect(body).toContain('"success":true');
    expect(ConnectorModel).toHaveBeenCalledWith({}, 'u1', 'ws1', {});
    expect(ConnectorToolModel).toHaveBeenCalledWith({}, 'u1', 'ws1');
  });

  it('keeps the failure page open and shows the escaped reason', async () => {
    mockFindById.mockResolvedValue(undefined);

    const body = await (await GET(makeReq())).text();

    expect(body).toContain('Authorization failed.');
    expect(body).toContain('>connector_not_found</p>');
    expect(body).not.toContain('window.close');
    expect(console.error).toHaveBeenCalled();
  });

  it('shows the provider error description without injecting markup', async () => {
    const body = await (
      await GET(makeReq('error=access_denied&error_description=%3Cimg%20src%3Dx%3E'))
    ).text();

    expect(body).toContain('access_denied: &lt;img src=x&gt;');
    expect(body).not.toContain('<img');
    expect(mockConsume).not.toHaveBeenCalled();
  });
});
