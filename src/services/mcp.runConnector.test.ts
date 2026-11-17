import { type ChatToolPayload } from '@lobechat/types';
import superjson from 'superjson';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';

import { mcpService } from './mcp';

/**
 * Which connector row a conversation's call runs on, and so where it runs: a
 * private agent's own topic may use its owner's private or personal connector,
 * a group or another agent's topic only the shared one. Only the server can
 * tell the two apart, so the desktop routes on the row it resolves
 * (`connector.resolveForRun`), never on the row ranked first here.
 */

const environment = vi.hoisted(() => ({
  deviceGatewayConfigured: false as boolean | undefined,
}));
// In a workspace the client asks the server which row a private agent's call runs on
const workspace = vi.hoisted(() => ({ id: null as string | null }));
const mockElectronIpc = vi.hoisted(() => ({ mcp: { callTool: vi.fn() } }));
const mockGetToolStoreState = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  CURRENT_VERSION: '1.0.0',
  isDesktop: true,
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => workspace.id,
  useActiveWorkspaceId: () => workspace.id,
}));
vi.mock('@/store/serverConfig/store', () => ({
  getServerConfigStoreState: () => ({
    featureFlags: { enableMcpApps: false },
    serverConfig: { deviceGatewayConfigured: environment.deviceGatewayConfigured },
  }),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: {
      callTool: { mutate: vi.fn() },
      getForRun: { query: vi.fn() },
      getLocalCallToken: { mutate: vi.fn() },
      resolveForRun: { query: vi.fn() },
    },
  },
  toolsClient: { mcp: { callTool: { mutate: vi.fn() } } },
}));
vi.mock('@/utils/electron/ipc', () => ({ ensureElectronIpc: () => mockElectronIpc }));
vi.mock('./discover', () => ({
  discoverService: {
    reportPluginCall: vi.fn().mockResolvedValue(undefined),
    safeInjectMPToken: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/store/tool/store', () => ({ getToolStoreState: () => mockGetToolStoreState() }));
vi.mock('@/store/tool/selectors', () => ({
  pluginSelectors: {
    getCustomPluginById: () => () => undefined,
    getInstalledPluginById: () => () => undefined,
  },
}));

const payload: ChatToolPayload = {
  id: 'local-call',
  identifier: 'local-connector',
  apiName: 'read_file',
  arguments: '{"path":"test.txt"}',
  type: 'standalone',
};
const connector = {
  id: 'connector-id',
  identifier: payload.identifier,
  isEnabled: true,
  mcpConnectionType: 'stdio',
};
const detail = {
  ...connector,
  mcpStdioConfig: { command: 'node', args: ['mcp.js'], env: { TOKEN: 'fresh-secret' } },
  tools: [{ toolName: 'read_file', permission: 'auto' }],
};

describe('mcpService.invokeMcpToolCall: the connector a conversation runs on', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    environment.deviceGatewayConfigured = false;
    workspace.id = null;
    mockGetToolStoreState.mockReturnValue({ connectors: [connector] });
    const { lambdaClient } = await import('@/libs/trpc/client');
    vi.mocked(lambdaClient.connector.getForRun.query).mockResolvedValue(detail as never);
  });

  it("runs the shared row's tool on the shared row, the private one beside it", async () => {
    // Regression: a private agent's private row was picked on the agent's
    // visibility alone, so in a conversation the server keeps private rows
    // out of (a group topic) the shared tool ran with the private account.
    // The private row is now a tool set of its own: the connector's
    // identifier names the shared row, whose configuration the server reads.
    const { lambdaClient } = await import('@/libs/trpc/client');
    mockGetToolStoreState.mockReturnValue({
      connectors: [
        { ...connector, id: 'connector-shared', visibility: 'public' },
        { ...connector, id: 'connector-private', visibility: 'private' },
      ],
    });
    vi.mocked(lambdaClient.connector.resolveForRun.query).mockResolvedValue({
      id: 'connector-shared',
    });
    const shared = {
      ...detail,
      id: 'connector-shared',
      mcpStdioConfig: { command: 'node', args: ['mcp.js'], env: { TOKEN: 'shared-secret' } },
    };
    vi.mocked(lambdaClient.connector.getForRun.query).mockResolvedValue(shared as never);
    mockElectronIpc.mcp.callTool.mockResolvedValue(superjson.serialize({ success: true }));

    await mcpService.invokeMcpToolCall(payload, {
      agentId: 'agt_private',
      topicId: 'tpc_group',
    });

    const run = {
      agentId: 'agt_private',
      identifier: payload.identifier,
      topicId: 'tpc_group',
    };
    expect(lambdaClient.connector.getForRun.query).toHaveBeenCalledWith(run);
    expect(superjson.deserialize(mockElectronIpc.mcp.callTool.mock.calls[0][0])).toMatchObject({
      env: { TOKEN: 'shared-secret' },
    });
  });

  it('sends the call to the server when the conversation runs a shared HTTP row', async () => {
    // Regression: the private stdio row was ranked first and took the IPC
    // route, then the server-resolved row turned out to be the shared HTTP
    // one (a group topic keeps private rows out), and the stdio check threw
    // instead of running the valid shared tool.
    const { lambdaClient } = await import('@/libs/trpc/client');
    // A private agent, whose private row the conversation might use
    useAgentStore.setState({ agentMap: { agt_private: { visibility: 'private' } } } as never);
    mockGetToolStoreState.mockReturnValue({
      connectors: [
        { ...connector, id: 'connector-private', visibility: 'private' },
        {
          ...connector,
          id: 'connector-shared',
          mcpConnectionType: 'http',
          mcpServerUrl: 'https://mcp.example.com/mcp',
          visibility: 'public',
        },
      ],
    });
    vi.mocked(lambdaClient.connector.resolveForRun.query).mockResolvedValue({
      id: 'connector-shared',
    });
    // What the server resolves: the shared HTTP row
    vi.mocked(lambdaClient.connector.getForRun.query).mockResolvedValue({
      ...detail,
      id: 'connector-shared',
      mcpConnectionType: 'http',
      mcpStdioConfig: null,
    } as never);
    const result = { content: 'shared result', success: true };
    vi.mocked(lambdaClient.connector.callTool.mutate).mockResolvedValue(result as never);

    await expect(
      mcpService.invokeMcpToolCall(payload, { agentId: 'agt_private', topicId: 'tpc_group' }),
    ).resolves.toEqual(result);
    expect(lambdaClient.connector.callTool.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agt_private', topicId: 'tpc_group' }),
      expect.anything(),
    );
    expect(lambdaClient.connector.getForRun.query).not.toHaveBeenCalled();
    expect(mockElectronIpc.mcp.callTool).not.toHaveBeenCalled();
  });

  it('runs the private stdio row over IPC once the server resolves it', async () => {
    const { lambdaClient } = await import('@/libs/trpc/client');
    mockGetToolStoreState.mockReturnValue({
      connectors: [
        { ...connector, id: 'connector-private', visibility: 'private' },
        {
          ...connector,
          id: 'connector-shared',
          mcpConnectionType: 'http',
          mcpServerUrl: 'https://mcp.example.com/mcp',
          visibility: 'public',
        },
      ],
    });
    vi.mocked(lambdaClient.connector.resolveForRun.query).mockResolvedValue({
      id: 'connector-private',
    });
    mockElectronIpc.mcp.callTool.mockResolvedValue(superjson.serialize({ success: true }));

    // The private row's tool set, under its row-suffixed prefix
    await mcpService.invokeMcpToolCall(
      { ...payload, identifier: 'local-connector-connecto' },
      { agentId: 'agt_private', topicId: 'tpc_own' },
    );

    expect(mockElectronIpc.mcp.callTool).toHaveBeenCalledTimes(1);
    expect(lambdaClient.connector.callTool.mutate).not.toHaveBeenCalled();
  });

  it('keeps a personal marketplace stdio install the server resolves on this desktop under a gateway', async () => {
    // A private agent's own topic in a workspace may run its owner's
    // personal connector, which no workspace list here holds, so the
    // client routes on the server's answer. Without the row's source in
    // that answer, a marketplace stdio install (which runs on the desktop
    // even with a device gateway, as its plugin did) went to the server
    // route, which cannot run stdio.
    environment.deviceGatewayConfigured = true;
    workspace.id = 'ws-1';
    mockGetToolStoreState.mockReturnValue({ connectors: [] });
    const { lambdaClient } = await import('@/libs/trpc/client');
    vi.mocked(lambdaClient.connector.resolveForRun.query).mockResolvedValue({
      ...connector,
      agentId: null,
      id: 'connector-personal',
      mcpServerUrl: null,
      metadata: { marketplaceInstalled: true },
      sourceType: 'marketplace',
      status: 'connected',
      tools: detail.tools,
    } as never);
    mockElectronIpc.mcp.callTool.mockResolvedValue(superjson.serialize({ success: true }));

    await mcpService.invokeMcpToolCall(payload, { agentId: 'agt_private', topicId: 'tpc_own' });

    expect(lambdaClient.connector.getForRun.query).toHaveBeenCalledWith({
      agentId: 'agt_private',
      identifier: payload.identifier,
      topicId: 'tpc_own',
    });
    expect(mockElectronIpc.mcp.callTool).toHaveBeenCalledTimes(1);
    expect(lambdaClient.connector.callTool.mutate).not.toHaveBeenCalled();
  });

  it("runs a personal OAuth server set to connect through the device here, with the token of the run's row", async () => {
    // A private agent's own topic in a workspace may run its owner's personal
    // HTTP connector, which no workspace list here holds. Its public-looking
    // address only reaches the server as "connect via device" when the
    // server's answer carries that choice; its OAuth token is read for the same
    // conversation, since the workspace scope alone cannot find a personal row.
    environment.deviceGatewayConfigured = true;
    workspace.id = 'ws-1';
    mockGetToolStoreState.mockReturnValue({ connectors: [] });
    const url = 'https://nas.tail1234.ts.net/mcp';
    const personal = {
      ...connector,
      agentId: null,
      id: '9f1f6f30-0000-4000-8000-00000000000a',
      mcpConnectionType: 'http',
      mcpServerUrl: url,
      metadata: { connectVia: 'device' },
      tools: detail.tools,
    };
    const { lambdaClient } = await import('@/libs/trpc/client');
    vi.mocked(lambdaClient.connector.resolveForRun.query).mockResolvedValue(personal as never);
    vi.mocked(lambdaClient.connector.getForRun.query).mockResolvedValue({
      ...personal,
      credentials: null,
      mcpStdioConfig: null,
      oidcConfig: { clientId: 'cid', issuer: 'https://auth.example.com' },
    } as never);
    vi.mocked(lambdaClient.connector.getLocalCallToken.mutate).mockResolvedValue({
      accessToken: 'personal-access',
      type: 'oauth2',
    });
    mockElectronIpc.mcp.callTool.mockResolvedValue(superjson.serialize({ success: true }));

    await mcpService.invokeMcpToolCall(payload, { agentId: 'agt_private', topicId: 'tpc_own' });

    const run = { agentId: 'agt_private', identifier: payload.identifier, topicId: 'tpc_own' };
    expect(lambdaClient.connector.getLocalCallToken.mutate).toHaveBeenCalledWith({
      id: personal.id,
      run,
    });
    expect(superjson.deserialize(mockElectronIpc.mcp.callTool.mock.calls[0][0])).toMatchObject({
      http: { auth: { accessToken: 'personal-access', type: 'oauth2' }, url },
    });
    expect(lambdaClient.connector.callTool.mutate).not.toHaveBeenCalled();
  });
});
