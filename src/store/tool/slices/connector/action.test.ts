import type * as LobechatConstModule from '@lobechat/const';
import type { ToolManifest } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoreSetter } from '@/store/types';

import type { ToolStore } from '../../store';
import { ConnectorActionImpl } from './action';
import type { ConnectorWithTools } from './types';

const desktopEnv = vi.hoisted(() => ({ isDesktop: true }));

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<typeof LobechatConstModule>();
  return {
    ...actual,
    get isDesktop() {
      return desktopEnv.isDesktop;
    },
  };
});

const clientMocks = vi.hoisted(() => ({
  listAgentBoundConnectors: vi.fn(),
  listConnectors: vi.fn(),
  syncTools: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: {
      list: { query: clientMocks.listConnectors },
      listAgentBound: { query: clientMocks.listAgentBoundConnectors },
      syncTools: { mutate: clientMocks.syncTools },
    },
  },
}));

const mcpMocks = vi.hoisted(() => ({
  getStdioMcpServerManifest: vi.fn(),
}));

vi.mock('@/services/mcp', () => ({
  mcpService: {
    getStdioMcpServerManifest: mcpMocks.getStdioMcpServerManifest,
  },
}));

const createConnector = (
  id: string,
  mcpConnectionType: string,
  overrides: Partial<ConnectorWithTools> = {},
): ConnectorWithTools => ({
  credentials: null,
  id,
  identifier: `${id}-identifier`,
  isEnabled: true,
  mcpConnectionType,
  mcpServerUrl: mcpConnectionType === 'http' ? 'https://mcp.example.com' : null,
  mcpStdioConfig: null,
  metadata: null,
  name: `${id} name`,
  sourceType: 'custom',
  status: 'connected',
  tools: [],
  ...overrides,
});

const createAction = (
  connectors: ConnectorWithTools[],
  agentBoundConnectors: ConnectorWithTools[] = [],
) => {
  const state = {
    agentBoundConnectors,
    connectorCreating: false,
    connectors,
    connectorSyncing: {},
    isAgentBoundInit: agentBoundConnectors.length > 0,
    isConnectorsInit: true,
  } as ToolStore;
  const set = ((partial: Parameters<StoreSetter<ToolStore>>[0]) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    Object.assign(state, next);
  }) as StoreSetter<ToolStore>;

  return { action: new ConnectorActionImpl(set, () => state), state };
};

const manifest: ToolManifest = {
  api: [
    {
      description: 'Find matching items',
      name: 'find_items',
      parameters: {
        properties: { query: { type: 'string' } },
        required: ['query'],
        type: 'object',
      },
    },
  ],
  identifier: 'target-connector',
  meta: { title: 'Target connector' },
  type: 'mcp',
};

beforeEach(() => {
  desktopEnv.isDesktop = true;
  clientMocks.listAgentBoundConnectors.mockReset().mockResolvedValue([]);
  clientMocks.listConnectors.mockReset().mockResolvedValue([]);
  clientMocks.syncTools.mockReset().mockResolvedValue({ toolCount: 1 });
  mcpMocks.getStdioMcpServerManifest.mockReset().mockResolvedValue(manifest);
});

describe('ConnectorActionImpl.syncConnectorTools', () => {
  it('fetches a Desktop STDIO manifest locally and syncs mapped tools by exact ID', async () => {
    const id = 'target-id';
    const decoy = createConnector('other-id', 'http', { identifier: id });
    const target = createConnector(id, 'stdio', {
      mcpStdioConfig: {
        args: ['server.js', '--stdio'],
        command: 'node',
        env: { MCP_TOKEN: 'local-only' },
      },
      name: 'Target connector',
    });
    const { action, state } = createAction([decoy, target]);

    await action.syncConnectorTools(id);

    expect(mcpMocks.getStdioMcpServerManifest).toHaveBeenCalledWith({
      args: ['server.js', '--stdio'],
      command: 'node',
      env: { MCP_TOKEN: 'local-only' },
      name: 'Target connector',
    });
    expect(clientMocks.syncTools).toHaveBeenCalledOnce();
    expect(clientMocks.syncTools).toHaveBeenCalledWith({
      id,
      tools: [
        {
          description: 'Find matching items',
          inputSchema: {
            properties: { query: { type: 'string' } },
            required: ['query'],
            type: 'object',
          },
          toolName: 'find_items',
        },
      ],
    });
    expect(clientMocks.listConnectors).toHaveBeenCalledOnce();
    expect(state.connectorSyncing[id]).toBe(false);
  });

  it('propagates a local fetch error, clears syncing state, and does not fall back remotely', async () => {
    const id = 'stdio-id';
    const error = new Error('STDIO process failed');
    const connector = createConnector(id, 'stdio', {
      mcpStdioConfig: { command: 'broken-command' },
    });
    const { action, state } = createAction([connector]);
    mcpMocks.getStdioMcpServerManifest.mockRejectedValueOnce(error);

    await expect(action.syncConnectorTools(id)).rejects.toBe(error);

    expect(clientMocks.syncTools).not.toHaveBeenCalled();
    expect(clientMocks.listConnectors).not.toHaveBeenCalled();
    expect(state.connectorSyncing[id]).toBe(false);
  });

  it('uses the ID-only sync path for Web STDIO', async () => {
    desktopEnv.isDesktop = false;
    const id = 'web-stdio-id';
    const connector = createConnector(id, 'stdio', {
      mcpStdioConfig: { command: 'node' },
    });
    const { action, state } = createAction([connector]);

    await action.syncConnectorTools(id);

    expect(mcpMocks.getStdioMcpServerManifest).not.toHaveBeenCalled();
    expect(clientMocks.syncTools).toHaveBeenCalledWith({ id });
    expect(state.connectorSyncing[id]).toBe(false);
  });

  it('uses the ID-only sync path for Desktop HTTP', async () => {
    const id = 'desktop-http-id';
    const { action, state } = createAction([createConnector(id, 'http')]);

    await action.syncConnectorTools(id);

    expect(mcpMocks.getStdioMcpServerManifest).not.toHaveBeenCalled();
    expect(clientMocks.syncTools).toHaveBeenCalledWith({ id });
    expect(state.connectorSyncing[id]).toBe(false);
  });

  it('syncs an agent-bound Desktop STDIO connector and refreshes its connector pool', async () => {
    const id = 'agent-stdio-id';
    const connector = createConnector(id, 'stdio', {
      agentId: 'agent-id',
      mcpStdioConfig: { command: 'node' },
    });
    const { action, state } = createAction([], [connector]);
    clientMocks.listAgentBoundConnectors.mockResolvedValue([connector]);

    await action.syncConnectorTools(id);

    expect(mcpMocks.getStdioMcpServerManifest).toHaveBeenCalledOnce();
    expect(clientMocks.syncTools).toHaveBeenCalledWith({
      id,
      tools: [
        expect.objectContaining({
          inputSchema: expect.objectContaining({ type: 'object' }),
          toolName: 'find_items',
        }),
      ],
    });
    expect(clientMocks.listAgentBoundConnectors).toHaveBeenCalledOnce();
    expect(state.connectorSyncing[id]).toBe(false);
  });

  it('refreshes a cold Desktop store before choosing the STDIO path', async () => {
    const id = 'missing-id';
    const connector = createConnector(id, 'stdio', {
      mcpStdioConfig: { command: 'node' },
    });
    const { action, state } = createAction([]);
    clientMocks.listConnectors.mockResolvedValue([connector]);

    await action.syncConnectorTools(id);

    expect(mcpMocks.getStdioMcpServerManifest).toHaveBeenCalledOnce();
    expect(clientMocks.syncTools).toHaveBeenCalledWith({
      id,
      tools: [
        {
          description: 'Find matching items',
          inputSchema: {
            properties: { query: { type: 'string' } },
            required: ['query'],
            type: 'object',
          },
          toolName: 'find_items',
        },
      ],
    });
    expect(clientMocks.listConnectors).toHaveBeenCalledTimes(2);
    expect(state.connectorSyncing[id]).toBe(false);
  });

  it('fails closed when a missing Desktop connector is still absent after refresh', async () => {
    const id = 'missing-id';
    const { action, state } = createAction([]);

    await expect(action.syncConnectorTools(id)).rejects.toThrow(
      `Connector ${id} was not found after refresh`,
    );

    expect(mcpMocks.getStdioMcpServerManifest).not.toHaveBeenCalled();
    expect(clientMocks.syncTools).not.toHaveBeenCalled();
    expect(clientMocks.listConnectors).toHaveBeenCalledOnce();
    expect(clientMocks.listAgentBoundConnectors).toHaveBeenCalledOnce();
    expect(state.connectorSyncing[id]).toBe(false);
  });
});
