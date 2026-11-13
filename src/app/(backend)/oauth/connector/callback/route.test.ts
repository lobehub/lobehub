import { runInNewContext } from 'node:vm';

import { IssuerMismatchError } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';

import { GET } from './route';

const {
  mockConsume,
  mockDiscover,
  mockExchange,
  mockFindById,
  mockSync,
  mockUpdate,
  mockListLinks,
  mockSaveAuthorization,
} = vi.hoisted(() => ({
  mockConsume: vi.fn(),
  mockListLinks: vi.fn(),
  mockSaveAuthorization: vi.fn(),
  mockDiscover: vi.fn().mockResolvedValue({ token_endpoint: 'https://as/token' }),
  mockExchange: vi.fn(),
  mockFindById: vi.fn(),
  mockSync: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('@/database/models/connectorLink', () => ({
  ConnectorLinkModel: vi.fn(function () {
    return {
      listByConnectorIds: mockListLinks,
      saveAuthorization: mockSaveAuthorization,
    };
  }),
}));
vi.mock('@/server/services/connector/identity', () => ({
  resolveLinkIdentity: async () => undefined,
}));
vi.mock('@/database/server', () => ({ serverDB: {} }));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.example.com' } }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn().mockResolvedValue({}) },
}));
vi.mock('@/server/services/connector/oauth', () => ({
  discoverConnectorAuthorizationServerMetadata: mockDiscover,
  exchangeConnectorCode: mockExchange,
  toClientInformation: (oidc: { clientId: string; clientSecret?: string }) => ({
    client_id: oidc.clientId,
    client_secret: oidc.clientSecret,
  }),
}));
vi.mock('@/server/services/connector/tokens', () => ({
  tokensToCredentials: vi
    .fn()
    .mockReturnValue({ credentials: { accessToken: 'tok', type: 'oauth2' }, tokenExpiresAt: null }),
}));
vi.mock('@/server/services/connector/stateStore', () => ({
  consumeConnectorOAuthState: mockConsume,
  saveConnectorOAuthCompletion: vi.fn(),
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
  mockListLinks.mockResolvedValue([]);
  mockSaveAuthorization
    .mockReset()
    .mockImplementation(async (_id, { target }) =>
      target.kind === 'existing'
        ? { linkId: target.linkId, outcome: 'reauthorized' }
        : { linkId: 'lnk_1', outcome: 'created' },
    );
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
  mockExchange.mockResolvedValue({ tokens: { access_token: 'tok' } });
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
        linkId: 'lnk_1',
        outcome: 'created',
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

  it('reauthorizes the earliest link for a legacy OAuth state without linkTarget', async () => {
    mockListLinks.mockResolvedValue([
      { id: 'lnk_early', status: 'error' },
      { id: 'lnk_late', status: 'connected' },
    ]);
    const body = await (await GET(makeReq())).text();
    expect(body).toContain('"success":true');
    expect(body).toContain('"linkId":"lnk_early"');
    expect(body).toContain('"outcome":"reauthorized"');
  });

  it('creates the first account for a legacy OAuth state when no links exist', async () => {
    const body = await (await GET(makeReq())).text();
    expect(body).toContain('"linkId":"lnk_1"');
    expect(body).toContain('"outcome":"created"');
  });

  it('keeps an explicit new-account target even when older links exist', async () => {
    mockConsume.mockResolvedValue({
      authorizationServerUrl: 'https://as',
      codeVerifier: 'v',
      connectorId: 'c1',
      lobeUserId: 'u1',
      linkTarget: { kind: 'new' },
    });
    mockListLinks.mockResolvedValue([{ id: 'lnk_early' }]);
    const body = await (await GET(makeReq())).text();
    expect(body).toContain('"outcome":"created"');
  });

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

  it('remembers the client auth method that the token endpoint accepted', async () => {
    mockSync.mockResolvedValue({ toolCount: 1 });
    mockExchange.mockResolvedValue({
      authMethod: 'client_secret_post',
      tokens: { access_token: 'tok' },
    });

    await GET(makeReq());

    expect(mockUpdate).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        oidcConfig: expect.objectContaining({
          clientId: 'cid',
          tokenEndpointAuthMethod: 'client_secret_post',
        }),
      }),
    );
  });

  it('leaves the OIDC config alone when the first auth method worked', async () => {
    mockSync.mockResolvedValue({ toolCount: 1 });

    await GET(makeReq());

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('SDK v2 OAuth callback regressions', () => {
  it('passes iss from the callback to the code exchange', async () => {
    await GET(makeReq('code=abc&state=xyz&iss=https%3A%2F%2Fas'));
    expect(mockExchange).toHaveBeenCalledWith(expect.objectContaining({ iss: 'https://as' }));
  });
  it.each(['exchange', 'discovery'])(
    'redacts the untrusted issuer on %s failure',
    async (stage) => {
      const error = new IssuerMismatchError(
        'authorization_response',
        'https://as',
        'https://attacker.example/untrusted',
      );
      if (stage === 'exchange') mockExchange.mockRejectedValueOnce(error);
      else mockDiscover.mockRejectedValueOnce(error);
      const response = await GET(makeReq());
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain('issuer_mismatch');
      expect(body).not.toContain('attacker.example');
      expect(mockUpdate).not.toHaveBeenCalled();
    },
  );
  it('renders a failure page when discovery has a network error', async () => {
    mockDiscover.mockRejectedValueOnce(new TypeError('network unavailable'));
    const response = await GET(makeReq());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Authorization failed.');
  });
});
