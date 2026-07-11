import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DecryptedConnector } from '@/database/models/connector';
import type { ConnectorCredentials } from '@/database/schemas';
import { ConnectorMcpConnectionType, ConnectorStatus } from '@/database/schemas';
import { mcpService } from '@/server/services/mcp';

import {
  buildConnectorMcpParams,
  buildHttpAuthFromCredentials,
  syncConnectorToolsById,
} from './sync';
import { ensureFreshConnectorToken } from './tokens';

vi.mock('@/server/services/mcp', () => ({ mcpService: { listRawTools: vi.fn() } }));
vi.mock('./tokens', () => ({ ensureFreshConnectorToken: vi.fn() }));

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

  it('maps oauth2 to bearer auth with refresh metadata', () => {
    const result = buildHttpAuthFromCredentials({
      accessToken: 'access',
      clientSecret: 'secret',
      expiresAt: 123,
      refreshToken: 'refresh',
      type: 'oauth2',
    });

    expect(result).toEqual({
      auth: {
        accessToken: 'access',
        clientId: undefined,
        clientSecret: 'secret',
        refreshToken: 'refresh',
        tokenExpiresAt: 123,
        type: 'oauth2',
      },
    });
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
  it('builds http params with bearer auth', () => {
    expect(buildConnectorMcpParams(httpConnector({ token: 'tok', type: 'bearer' }))).toEqual({
      auth: { token: 'tok', type: 'bearer' },
      headers: undefined,
      name: 'My Connector',
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
      name: 'My Connector',
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
      name: 'My Connector',
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
      name: 'My Connector',
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
      name: 'My Connector',
      type: 'http',
      url: 'https://mcp.example.com',
    });
  });

  it('builds http params with no auth when credentials are absent', () => {
    expect(buildConnectorMcpParams(httpConnector(null))).toEqual({
      auth: undefined,
      headers: undefined,
      name: 'My Connector',
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
      name: 'Local Connector',
      type: 'stdio',
    });
  });
});

describe('syncConnectorToolsById', () => {
  const connectorId = '11111111-1111-4111-8111-111111111111';

  const stdioConnector = {
    credentials: {
      accessToken: 'must-not-refresh',
      expiresAt: 0,
      refreshToken: 'refresh-token',
      type: 'oauth2',
    },
    id: connectorId,
    identifier: 'local-connector',
    isEnabled: true,
    mcpConnectionType: ConnectorMcpConnectionType.stdio,
    mcpServerUrl: null,
    mcpStdioConfig: {
      args: ['--serve'],
      command: '/usr/bin/local-mcp',
      env: { API_KEY: 'secret' },
    },
    metadata: { custom: 'preserved' },
    name: 'Local Connector',
    oidcConfig: {
      clientId: 'client-id',
      issuer: 'https://auth.example.com',
      scheme: 'pre_registration',
    },
    sourceType: 'custom',
    status: ConnectorStatus.disconnected,
  } as unknown as DecryptedConnector;

  const createContext = (connector: DecryptedConnector | null = stdioConnector) => {
    const connectorModel = {
      findById: vi.fn().mockResolvedValue(connector),
      update: vi.fn(),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    };
    const connectorToolModel = {
      upsertMany: vi.fn().mockResolvedValue(undefined),
    };

    return {
      connectorModel,
      connectorToolModel,
      ctx: { connectorModel, connectorToolModel } as any,
    };
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(ensureFreshConnectorToken).mockImplementation(async (connector) => connector);
  });

  it('persists supplied stdio tools against the exact UUID without fetching or refreshing', async () => {
    const { connectorModel, connectorToolModel, ctx } = createContext();
    const tools = [
      {
        description: 'Read the current weather',
        inputSchema: { properties: { city: { type: 'string' } }, type: 'object' },
        toolName: 'get_weather',
      },
      { toolName: 'create_note' },
    ];

    const result = await syncConnectorToolsById(connectorId, ctx, tools);

    expect(result).toEqual({ toolCount: 2 });
    expect(connectorModel.findById).toHaveBeenCalledWith(connectorId);
    expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
    expect(mcpService.listRawTools).not.toHaveBeenCalled();
    expect(connectorToolModel.upsertMany).toHaveBeenCalledWith(connectorId, [
      {
        crudType: 'read',
        description: 'Read the current weather',
        inputSchema: { properties: { city: { type: 'string' } }, type: 'object' },
        toolName: 'get_weather',
      },
      {
        crudType: 'write',
        description: undefined,
        inputSchema: undefined,
        toolName: 'create_note',
      },
    ]);
    expect(connectorModel.updateStatus).toHaveBeenCalledWith(
      connectorId,
      ConnectorStatus.connected,
    );
    expect(connectorModel.update).not.toHaveBeenCalled();
  });

  it('keeps an empty supplied stdio tool list on the client persistence path', async () => {
    const { connectorModel, connectorToolModel, ctx } = createContext();

    const result = await syncConnectorToolsById(connectorId, ctx, []);

    expect(result).toEqual({ toolCount: 0 });
    expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
    expect(mcpService.listRawTools).not.toHaveBeenCalled();
    expect(connectorToolModel.upsertMany).toHaveBeenCalledWith(connectorId, []);
    expect(connectorModel.updateStatus).toHaveBeenCalledWith(
      connectorId,
      ConnectorStatus.connected,
    );
    expect(connectorModel.update).not.toHaveBeenCalled();
  });

  it('rejects supplied tools for an HTTP connector before any sync side effects', async () => {
    const connector = httpConnector(null) as DecryptedConnector;
    connector.id = connectorId;
    const { connectorModel, connectorToolModel, ctx } = createContext(connector);

    await expect(
      syncConnectorToolsById(connectorId, ctx, [{ toolName: 'get_weather' }]),
    ).rejects.toThrow('Client-supplied tools are only supported for stdio connectors');

    expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
    expect(mcpService.listRawTools).not.toHaveBeenCalled();
    expect(connectorToolModel.upsertMany).not.toHaveBeenCalled();
    expect(connectorModel.updateStatus).not.toHaveBeenCalled();
    expect(connectorModel.update).not.toHaveBeenCalled();
  });

  it('rejects supplied tools for a STDIO connector without a command', async () => {
    const connector = {
      ...stdioConnector,
      mcpStdioConfig: { args: [] },
    } as unknown as DecryptedConnector;
    const { connectorModel, connectorToolModel, ctx } = createContext(connector);

    await expect(
      syncConnectorToolsById(connectorId, ctx, [{ toolName: 'get_weather' }]),
    ).rejects.toThrow('Connector has no valid STDIO configuration');

    expect(ensureFreshConnectorToken).not.toHaveBeenCalled();
    expect(mcpService.listRawTools).not.toHaveBeenCalled();
    expect(connectorToolModel.upsertMany).not.toHaveBeenCalled();
    expect(connectorModel.updateStatus).not.toHaveBeenCalled();
  });

  it('keeps the ID-only path fetching and normalizing tools from MCP', async () => {
    const connector = httpConnector(null) as DecryptedConnector;
    connector.id = connectorId;
    const { connectorModel, connectorToolModel, ctx } = createContext(connector);
    vi.mocked(mcpService.listRawTools).mockResolvedValue([
      {
        description: 'Search remotely',
        inputSchema: { properties: { query: { type: 'string' } }, type: 'object' },
        name: 'search_remote',
      },
    ] as any);

    const result = await syncConnectorToolsById(connectorId, ctx);

    expect(result).toEqual({ toolCount: 1 });
    expect(ensureFreshConnectorToken).toHaveBeenCalledWith(connector, connectorModel);
    expect(mcpService.listRawTools).toHaveBeenCalledWith({
      auth: undefined,
      headers: undefined,
      name: 'My Connector',
      type: 'http',
      url: 'https://mcp.example.com',
    });
    expect(connectorToolModel.upsertMany).toHaveBeenCalledWith(connectorId, [
      {
        crudType: 'read',
        description: 'Search remotely',
        inputSchema: { properties: { query: { type: 'string' } }, type: 'object' },
        toolName: 'search_remote',
      },
    ]);
    expect(connectorModel.updateStatus).toHaveBeenCalledWith(
      connectorId,
      ConnectorStatus.connected,
    );
  });

  it('keeps the ID-only MCP fetch failure status behavior', async () => {
    const connector = httpConnector(null) as DecryptedConnector;
    connector.id = connectorId;
    const { connectorModel, connectorToolModel, ctx } = createContext(connector);
    const fetchError = new Error('MCP unavailable');
    vi.mocked(mcpService.listRawTools).mockRejectedValue(fetchError);

    await expect(syncConnectorToolsById(connectorId, ctx)).rejects.toBe(fetchError);

    expect(connectorModel.updateStatus).toHaveBeenCalledWith(connectorId, ConnectorStatus.error);
    expect(connectorToolModel.upsertMany).not.toHaveBeenCalled();
  });
});
