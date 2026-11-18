// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { DeletedResourceSchema } from '../types/common.type';
import { McpServerSchema, McpServerSyncResultSchema } from '../types/mcp-server.type';
import { McpServerService } from './mcp-server.service';

const { claimMock, connectorInstances, hasAnyPermissionMock, syncConnectorToolsByIdMock } =
  vi.hoisted(() => ({
    claimMock: vi.fn(),
    connectorInstances: [] as any[],
    hasAnyPermissionMock: vi.fn(),
    syncConnectorToolsByIdMock: vi.fn(),
  }));

vi.mock('@/const/rbac', () => ({ ALL_SCOPE: 'all' }));
vi.mock('@lobechat/database', () => ({
  buildWorkspacePayload: vi.fn(),
  buildWorkspaceWhere: vi.fn(),
}));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = hasAnyPermissionMock;
  },
}));
vi.mock('@/database/schemas', () => ({
  ConnectorMcpConnectionType: { http: 'http' },
  ConnectorSourceType: { custom: 'custom' },
  ConnectorStatus: { connected: 'connected', disconnected: 'disconnected' },
  agents: {},
  aiModels: {},
  aiProviders: {},
  files: {},
  knowledgeBases: {},
  messages: {},
  sessions: {},
  topics: {},
}));
vi.mock('@/utils/rbac', () => ({ getScopePermissions: () => [] }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn().mockResolvedValue({}) },
}));
vi.mock('@/server/services/connector/sync', () => ({
  syncConnectorToolsById: syncConnectorToolsByIdMock,
}));
vi.mock('@/database/models/connectorTool', () => ({
  ConnectorToolModel: class {
    queryByConnector = vi.fn().mockResolvedValue([]);
  },
}));
vi.mock('@/database/models/connector', () => ({
  ConnectorModel: class {
    create = vi.fn().mockResolvedValue({ id: 'mcp-1' });
    createUnlessIdentifierHeld = claimMock;
    delete = vi.fn();
    findById = vi.fn().mockResolvedValue({ id: 'mcp-1', metadata: {} });
    findPublicById = vi.fn().mockResolvedValue({
      agentId: null,
      id: 'mcp-1',
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://example.com/mcp',
      sourceType: 'custom',
      // The row was created by a different workspace member.
      userId: 'other-member',
    });
    // A lookup made before a concurrent writer added the identifier
    queryPublic = vi.fn().mockResolvedValue([]);
    update = vi.fn();
    constructor() {
      connectorInstances.push(this);
    }
  },
}));

const OWNER = 'me';
const WORKSPACE = 'ws-1';

describe('McpServerService row-level manage checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectorInstances.length = 0;
    // Caller holds only the `:owner` scope, not workspace-wide `:all`.
    hasAnyPermissionMock.mockResolvedValue(false);
  });

  const service = () => new McpServerService({} as LobeChatDatabase, OWNER, WORKSPACE);

  it.each(['updateServer', 'deleteServer', 'syncServer'] as const)(
    'refuses %s on a row created by another workspace member',
    async (method) => {
      const svc = service();
      const call =
        method === 'updateServer' ? svc.updateServer('mcp-1', { name: 'x' }) : svc[method]('mcp-1');

      await expect(call).rejects.toThrow(/Only the creator or a workspace owner/);
      expect(connectorInstances.every((it) => it.update.mock.calls.length === 0)).toBe(true);
      expect(connectorInstances.every((it) => it.delete.mock.calls.length === 0)).toBe(true);
      expect(syncConnectorToolsByIdMock).not.toHaveBeenCalled();
    },
  );

  it('allows a workspace-wide (:all scope) caller to manage another member row', async () => {
    hasAnyPermissionMock.mockResolvedValue(true);

    const deleted = await service().deleteServer('mcp-1');

    expect(deleted).toEqual({ deleted: true, id: 'mcp-1' });
    expect(() => DeletedResourceSchema.parse(deleted)).not.toThrow();
  });

  it('answers sync with the documented result shape', async () => {
    hasAnyPermissionMock.mockResolvedValue(true);
    syncConnectorToolsByIdMock.mockResolvedValue({ toolCount: 3 });

    const result = await service().syncServer('mcp-1');

    expect(result).toEqual({ id: 'mcp-1', status: 'connected', toolCount: 3 });
    expect(() => McpServerSyncResultSchema.parse(result)).not.toThrow();
  });

  it('allows managing a row the caller created', async () => {
    const svc = service();
    connectorInstances.forEach((it) =>
      it.findPublicById.mockResolvedValue({
        agentId: null,
        id: 'mcp-1',
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://example.com/mcp',
        sourceType: 'custom',
        userId: OWNER,
      }),
    );

    await expect(svc.deleteServer('mcp-1')).resolves.toEqual({ deleted: true, id: 'mcp-1' });
  });

  // The list route only surfaces base connectors (`agent_id IS NULL`), and the
  // connector router unpins an agent's plugin on delete. Reaching an
  // agent-scoped row through an id route would skip that cleanup.
  it.each(['getServer', 'updateServer', 'deleteServer', 'syncServer'] as const)(
    'treats an agent-scoped connector as not found for %s',
    async (method) => {
      hasAnyPermissionMock.mockResolvedValue(true);
      const svc = service();
      connectorInstances.forEach((it) =>
        it.findPublicById.mockResolvedValue({
          agentId: 'agent-1',
          id: 'mcp-1',
          mcpConnectionType: 'http',
          mcpServerUrl: 'https://example.com/mcp',
          sourceType: 'custom',
          userId: OWNER,
        }),
      );

      const call =
        method === 'updateServer' ? svc.updateServer('mcp-1', { name: 'x' }) : svc[method]('mcp-1');

      await expect(call).rejects.toThrow(/MCP server not found/);
      expect(connectorInstances.every((it) => it.delete.mock.calls.length === 0)).toBe(true);
      expect(syncConnectorToolsByIdMock).not.toHaveBeenCalled();
    },
  );
});

describe('McpServerService.createServer', () => {
  const request = { identifier: 'fetch-mcp', name: 'Fetch', serverUrl: 'https://example.com/mcp' };

  beforeEach(() => {
    vi.clearAllMocks();
    connectorInstances.length = 0;
    claimMock.mockResolvedValue({ created: { id: 'mcp-1' } });
  });

  it('claims the identifier under the identifier lock and creates the server', async () => {
    await expect(
      new McpServerService({} as LobeChatDatabase, OWNER, WORKSPACE).createServer(request),
    ).resolves.toMatchObject({ id: 'mcp-1', serverUrl: 'https://example.com/mcp' });

    expect(claimMock.mock.calls).toEqual([[expect.objectContaining({ identifier: 'fetch-mcp' })]]);
  });

  it('reports an identifier another writer holds as a conflict instead of adding a row', async () => {
    const service = new McpServerService({} as LobeChatDatabase, OWNER, WORKSPACE);
    // An Agent Builder install claimed the identifier after any earlier lookup
    claimMock.mockResolvedValue({ holder: { id: 'installed' } });

    await expect(service.createServer(request)).rejects.toMatchObject({
      message: 'MCP server identifier already exists',
      name: 'ConflictError',
    });
    expect(connectorInstances.every((it) => it.create.mock.calls.length === 0)).toBe(true);
  });
});

describe('McpServerService response projection', () => {
  it('projects a server into the documented McpServer shape without credentials', async () => {
    const svc = new McpServerService({} as LobeChatDatabase, OWNER, WORKSPACE);
    const now = new Date('2026-01-01T00:00:00.000Z');
    connectorInstances.forEach((it) =>
      it.findPublicById.mockResolvedValue({
        agentId: null,
        avatar: null,
        createdAt: now,
        description: 'Fetch pages',
        hasCredentials: true,
        id: '00000000-0000-4000-8000-000000000001',
        identifier: 'fetch-mcp',
        isEnabled: true,
        mcpConnectionType: 'http',
        mcpServerUrl: 'https://example.com/mcp',
        mountedByAgentId: null,
        name: 'Fetch',
        sourceType: 'custom',
        status: 'disconnected',
        updatedAt: now,
        userId: OWNER,
      }),
    );

    const server = await svc.getServer('00000000-0000-4000-8000-000000000001');

    // Dates leave the API as ISO strings, which is what the schema describes.
    expect(() => McpServerSchema.parse(JSON.parse(JSON.stringify(server)))).not.toThrow();
  });
});
