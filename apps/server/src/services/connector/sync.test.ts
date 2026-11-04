import { describe, expect, it, vi } from 'vitest';

import type { DecryptedConnector } from '@/database/models/connector';
import type { ConnectorCredentials } from '@/database/schemas';
import { buildConnectorManifests } from '@/libs/mcp/buildConnectorManifests';
import { mcpService } from '@/server/services/mcp';

import {
  buildConnectorMcpParams,
  buildHttpAuthFromCredentials,
  syncConnectorToolsById,
} from './sync';

vi.mock('@/server/services/mcp', () => ({ mcpService: { listRawTools: vi.fn() } }));
const mcpAppsEnabled = vi.hoisted(() => vi.fn().mockResolvedValue(false));
vi.mock('@/server/services/mcp/featureGate', () => ({ isMcpAppsEnabled: mcpAppsEnabled }));
vi.mock('./tokens', () => ({ ensureFreshConnectorToken: async (connector: unknown) => connector }));

const httpConnector = (
  credentials: ConnectorCredentials | null,
  metadata?: Record<string, unknown>,
): DecryptedConnector =>
  ({
    credentials,
    id: 'c1',
    identifier: 'my-conn',
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://mcp.example.com',
    mcpStdioConfig: null,
    metadata: metadata ?? null,
    name: 'My Connector',
    oidcConfig: null,
  }) as any;

describe('buildHttpAuthFromCredentials', () => {
  it('returns nothing for no credentials (no-auth)', () => {
    expect(buildHttpAuthFromCredentials(null)).toEqual({});
  });

  it('maps oauth2 to the access token alone, already refreshed by the caller', () => {
    const result = buildHttpAuthFromCredentials({
      accessToken: 'access',
      clientSecret: 'secret',
      expiresAt: 123,
      refreshToken: 'refresh',
      type: 'oauth2',
    });

    expect(result).toEqual({ auth: { accessToken: 'access', type: 'oauth2' } });
    expect(result.headers).toBeUndefined();
  });

  it('maps a bearer token to bearer auth', () => {
    expect(buildHttpAuthFromCredentials({ token: 'tok', type: 'bearer' })).toEqual({
      auth: { token: 'tok', type: 'bearer' },
    });
  });

  it('maps an api key to bearer auth (Authorization header)', () => {
    expect(buildHttpAuthFromCredentials({ apiKey: 'key-123', type: 'apikey' })).toEqual({
      auth: { token: 'key-123', type: 'bearer' },
    });
  });

  it('passes custom headers through verbatim with no auth', () => {
    const result = buildHttpAuthFromCredentials({
      headers: { 'X-Api-Key': 'abc', 'X-Tenant': 't1' },
      type: 'header',
    });

    expect(result).toEqual({ headers: { 'X-Api-Key': 'abc', 'X-Tenant': 't1' } });
    expect(result.auth).toBeUndefined();
  });
});

describe('buildConnectorMcpParams', () => {
  it('matches the params agent runs use for an OAuth connector too', () => {
    const connector = httpConnector({
      accessToken: 'access',
      clientSecret: 'secret',
      expiresAt: 123,
      refreshToken: 'refresh',
      type: 'oauth2',
    });
    const [manifest] = buildConnectorManifests(
      [connector],
      [{ toolName: 'do_thing', userConnectorId: 'c1' } as any],
    );

    expect(buildConnectorMcpParams(connector)).toEqual((manifest as any).mcpParams);
  });

  it('matches the params agent runs use, so a view reaches the same MCP session', () => {
    // Display name differs from the identifier: the session key must not depend on it
    const connector = httpConnector(
      { token: 'tok', type: 'bearer' },
      { customHeaders: { x: '1' } },
    );
    const [manifest] = buildConnectorManifests(
      [connector],
      [{ toolName: 'do_thing', userConnectorId: 'c1' } as any],
    );

    expect(buildConnectorMcpParams(connector)).toEqual((manifest as any).mcpParams);
  });

  it('builds http params with bearer auth', () => {
    expect(buildConnectorMcpParams(httpConnector({ token: 'tok', type: 'bearer' }))).toEqual({
      auth: { token: 'tok', type: 'bearer' },
      headers: undefined,
      name: 'my-conn',
      type: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('builds http params with custom headers and no auth', () => {
    expect(
      buildConnectorMcpParams(
        httpConnector({ headers: { Authorization: 'Token x' }, type: 'header' }),
      ),
    ).toEqual({
      auth: undefined,
      headers: { Authorization: 'Token x' },
      name: 'my-conn',
      type: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('merges metadata.customHeaders alongside bearer auth', () => {
    expect(
      buildConnectorMcpParams(
        httpConnector({ token: 'tok', type: 'bearer' }, { customHeaders: { 'X-Tenant': 't1' } }),
      ),
    ).toEqual({
      auth: { token: 'tok', type: 'bearer' },
      headers: { 'X-Tenant': 't1' },
      name: 'my-conn',
      type: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('applies metadata.customHeaders with no auth credential', () => {
    expect(
      buildConnectorMcpParams(httpConnector(null, { customHeaders: { 'X-Api-Key': 'abc' } })),
    ).toEqual({
      auth: undefined,
      headers: { 'X-Api-Key': 'abc' },
      name: 'my-conn',
      type: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('lets metadata.customHeaders override legacy header-credential keys', () => {
    expect(
      buildConnectorMcpParams(
        httpConnector(
          { headers: { Authorization: 'Token old' }, type: 'header' },
          { customHeaders: { Authorization: 'Token new' } },
        ),
      ),
    ).toEqual({
      auth: undefined,
      headers: { Authorization: 'Token new' },
      name: 'my-conn',
      type: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('builds http params with no auth when credentials are absent', () => {
    expect(buildConnectorMcpParams(httpConnector(null))).toEqual({
      auth: undefined,
      headers: undefined,
      name: 'my-conn',
      type: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('builds stdio params from stdio config', () => {
    const connector = {
      credentials: null,
      identifier: 'local-conn',
      mcpConnectionType: 'stdio',
      mcpServerUrl: null,
      mcpStdioConfig: { args: ['serve'], command: 'my-mcp', env: { FOO: 'bar' } },
      name: 'Local Connector',
    } as any;

    expect(buildConnectorMcpParams(connector)).toEqual({
      args: ['serve'],
      command: 'my-mcp',
      env: { FOO: 'bar' },
      name: 'local-conn',
      type: 'stdio',
    });
  });
});

describe('syncConnectorToolsById', () => {
  it("syncs view-only tools too, recording each tool's MCP Apps visibility", async () => {
    vi.mocked(mcpService.listRawTools).mockResolvedValue([
      { description: 'Show', inputSchema: { type: 'object' }, name: 'show_dashboard' },
      {
        _meta: { ui: { visibility: ['app'] } },
        description: 'Page',
        inputSchema: { type: 'object' },
        name: 'load_page',
      },
    ]);
    const upsertMany = vi.fn();
    const updateStatus = vi.fn();

    const result = await syncConnectorToolsById('c1', {
      connectorModel: { findById: async () => httpConnector(null), updateStatus } as any,
      connectorToolModel: { upsertMany } as any,
    });

    expect(result).toEqual({ toolCount: 2 });
    expect(upsertMany).toHaveBeenCalledWith('c1', [
      expect.objectContaining({ metadata: null, toolName: 'show_dashboard' }),
      expect.objectContaining({ metadata: { visibility: ['app'] }, toolName: 'load_page' }),
    ]);
  });

  it.each([true, false])(
    "lists on a session announcing MCP Apps under the user's flag (%s)",
    async (enabled) => {
      // A server may list the tools only its views call just to such a client
      mcpAppsEnabled.mockResolvedValueOnce(enabled);
      vi.mocked(mcpService.listRawTools).mockResolvedValue([]);

      await syncConnectorToolsById('c1', {
        connectorModel: { findById: async () => httpConnector(null), updateStatus: vi.fn() } as any,
        connectorToolModel: { upsertMany: vi.fn() } as any,
        userId: 'user-1',
      });

      expect(mcpAppsEnabled).toHaveBeenCalledWith('user-1');
      expect(mcpService.listRawTools).toHaveBeenCalledWith(expect.anything(), {
        mcpApps: enabled,
      });
    },
  );
});
