// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';

import { connectorRouter } from '../connector';

const mocks = vi.hoisted(() => ({ saveState: vi.fn() }));

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.example.com' } }));
vi.mock('@/server/services/connector/stateStore', () => ({
  generateConnectorOAuthState: () => 'state-1',
  saveConnectorOAuthState: mocks.saveState,
}));
// The authorization server below is a stubbed global fetch; the SSRF boundary
// is covered by oauth.network.test.ts.
vi.mock('@lobechat/ssrf-safe-fetch', () => ({
  ssrfSafeFetch: (url: string, init?: RequestInit) => fetch(url, init),
}));

const CONNECTOR_ID = '9f1f6f30-0000-4000-8000-000000000003';
const METADATA_URL = 'https://app.example.com/oauth/connector/client-metadata.json';

/** Authorization server co-located with the MCP server, advertising `metadata`. */
const stubAuthorizationServer = (metadata: Record<string, unknown>) => {
  const registrations: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href === 'https://mcp.example.com/.well-known/oauth-authorization-server') {
        return Response.json({
          authorization_endpoint: 'https://mcp.example.com/authorize',
          code_challenge_methods_supported: ['S256'],
          issuer: 'https://mcp.example.com/',
          response_types_supported: ['code'],
          token_endpoint: 'https://mcp.example.com/token',
          ...metadata,
        });
      }
      if (href === 'https://mcp.example.com/register') {
        registrations.push(JSON.parse(String(init?.body)));
        return Response.json({ client_id: 'dcr-client', redirect_uris: [] }, { status: 201 });
      }
      return new Response(null, { status: 404 });
    }),
  );
  return registrations;
};

describe('connectorRouter.startOAuth client registration', () => {
  let connectorModelMock: any;
  const startOAuth = () =>
    connectorRouter
      .createCaller({ serverDB: {}, userId: 'me' } as any)
      .startOAuth({ id: CONNECTOR_ID });

  beforeEach(() => {
    vi.clearAllMocks();
    connectorModelMock = {
      findById: vi.fn().mockResolvedValue({
        id: CONNECTOR_ID,
        mcpServerUrl: 'https://mcp.example.com/mcp',
        oidcConfig: { scheme: 'dcr' },
        userId: 'me',
      }),
      update: vi.fn(),
    };
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return connectorModelMock;
    });
    vi.mocked(ConnectorToolModel).mockImplementation(function () {
      return {} as any;
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('authorizes with the client metadata URL when the server supports CIMD but not DCR', async () => {
    // Regression: without a registration endpoint this failed with
    // "This server does not support dynamic registration".
    const registrations = stubAuthorizationServer({ client_id_metadata_document_supported: true });

    const { authorizationUrl } = await startOAuth();

    expect(new URL(authorizationUrl).searchParams.get('client_id')).toBe(METADATA_URL);
    expect(registrations).toHaveLength(0);
    expect(connectorModelMock.update).toHaveBeenCalledWith(CONNECTOR_ID, {
      oidcConfig: expect.objectContaining({
        clientId: METADATA_URL,
        scheme: 'client_id_metadata_document',
        tokenEndpointAuthMethod: 'none',
      }),
    });
  });

  it('prefers CIMD over DCR when the server supports both', async () => {
    const registrations = stubAuthorizationServer({
      client_id_metadata_document_supported: true,
      registration_endpoint: 'https://mcp.example.com/register',
    });

    const { authorizationUrl } = await startOAuth();

    expect(new URL(authorizationUrl).searchParams.get('client_id')).toBe(METADATA_URL);
    expect(registrations).toHaveLength(0);
  });

  it('keeps dynamic registration for servers without CIMD support', async () => {
    const registrations = stubAuthorizationServer({
      registration_endpoint: 'https://mcp.example.com/register',
    });

    const { authorizationUrl } = await startOAuth();

    expect(new URL(authorizationUrl).searchParams.get('client_id')).toBe('dcr-client');
    expect(registrations).toHaveLength(1);
    expect(connectorModelMock.update).toHaveBeenCalledWith(CONNECTOR_ID, {
      oidcConfig: expect.objectContaining({ clientId: 'dcr-client', scheme: 'dcr' }),
    });
  });

  it('reports a server that offers no way to identify the client as a bad request', async () => {
    stubAuthorizationServer({});

    await expect(startOAuth()).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('neither Client ID Metadata Documents nor dynamic'),
    });
  });
});
