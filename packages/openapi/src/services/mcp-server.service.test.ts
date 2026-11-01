// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { McpServerService } from './mcp-server.service';

const { connectorInstances, hasAnyPermissionMock, syncConnectorToolsByIdMock } = vi.hoisted(() => ({
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

    await expect(service().deleteServer('mcp-1')).resolves.toEqual({ id: 'mcp-1' });
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

    await expect(svc.deleteServer('mcp-1')).resolves.toEqual({ id: 'mcp-1' });
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
