import { type ChatToolPayload } from '@lobechat/types';
import superjson from 'superjson';
import { beforeEach, expect, it, vi } from 'vitest';

import { mcpService } from './mcp';

const mockElectronIpc = {
  mcp: {
    callTool: vi.fn(),
    getStreamableMcpServerManifest: vi.fn(),
    getStdioMcpServerManifest: vi.fn(),
    listTools: vi.fn(),
    validMcpServerInstallable: vi.fn(),
  },
};

const environment = vi.hoisted(() => ({
  isDesktop: false,
  deviceGatewayConfigured: undefined as boolean | undefined,
}));

vi.mock('@/store/serverConfig/store', () => ({
  getServerConfigStoreState: () => ({
    featureFlags: { enableMcpApps: false },
    serverConfig: { deviceGatewayConfigured: environment.deviceGatewayConfigured },
  }),
}));

// Mock dependencies. Spread the real module: the connector slice this service
// pulls in lazily now reaches the user store chain, which reads `DEFAULT_AGENT`
// from `@lobechat/const` — a partial factory would break on that missing export.
vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  CURRENT_VERSION: '1.0.0',
  get isDesktop() {
    return environment.isDesktop;
  },
}));

vi.mock('@lobechat/utils', () => ({
  isLocalOrPrivateUrl: vi.fn((url: string) => {
    return url.includes('127.0.0.1') || url.includes('localhost') || url.includes('192.168.');
  }),
  safeParseJSON: vi.fn((str: string) => {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }),
}));

vi.mock('@/libs/trpc/client', () => {
  const result = {
    lambdaClient: {
      mcpElicitation: {
        startClientTool: { mutate: vi.fn() },
        clientToolOutcome: { query: vi.fn() },
      },
      connector: {
        callTool: { mutate: vi.fn() },
        getForRun: { query: vi.fn() },
        resolveForRun: { query: vi.fn() },
      },
    },
    toolsClient: {
      market: {
        callCloudMcpEndpoint: {
          mutate: vi.fn(),
        },
      },
      mcp: {
        callTool: {
          mutate: vi.fn(),
        },
        getStreamableMcpServerManifest: {
          query: vi.fn(),
        },
      },
    },
  };
  return {
    ...result,
    createWorkspaceLambdaClient: vi.fn(() => result.lambdaClient),
    createWorkspaceToolsClient: vi.fn(() => result.toolsClient),
  };
});

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => mockElectronIpc,
}));

vi.mock('./discover', () => ({
  discoverService: {
    safeInjectMPToken: vi.fn().mockResolvedValue(undefined),
    reportPluginCall: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock tool store
const mockGetToolStoreState = vi.fn();
const mockPluginSelectors = {
  getInstalledPluginById: vi.fn(),
  getCustomPluginById: vi.fn(),
};

vi.mock('@/store/tool/store', () => ({
  getToolStoreState: () => mockGetToolStoreState(),
}));

vi.mock('@/store/tool/selectors', () => ({
  pluginSelectors: mockPluginSelectors,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  environment.isDesktop = false;
  environment.deviceGatewayConfigured = undefined;
  mockGetToolStoreState.mockReturnValue({});
  // Like the real selectors: a lookup function that finds no plugin by default
  mockPluginSelectors.getInstalledPluginById.mockReturnValue(() => undefined);
  mockPluginSelectors.getCustomPluginById.mockReturnValue(() => undefined);
});

it('resolves a server-dispatched stdio connector before the settings store is initialized', async () => {
  environment.isDesktop = true;
  environment.deviceGatewayConfigured = false;
  const { lambdaClient } = await import('@/libs/trpc/client');
  vi.mocked(lambdaClient.connector.resolveForRun.query).mockResolvedValueOnce({
    id: 'fresh',
    identifier: 'cold-stdio',
    isEnabled: true,
    mcpConnectionType: 'stdio',
  } as any);
  vi.mocked(lambdaClient.connector.getForRun.query).mockResolvedValueOnce({
    id: 'fresh',
    identifier: 'cold-stdio',
    isEnabled: true,
    mcpConnectionType: 'stdio',
    tools: [{ toolName: 'form', permission: 'auto' }],
    mcpStdioConfig: { command: 'node', args: ['server.mjs'] },
  } as any);
  mockElectronIpc.mcp.callTool.mockResolvedValue(
    superjson.serialize({ content: 'continued', success: true, state: {} }),
  );
  const identity = {
    apiName: 'form',
    assistantMessageId: 'assistant',
    identifier: 'cold-stdio',
    operationId: 'op',
    toolCallId: 'original',
  };
  const result = await mcpService.invokeMcpToolCall(
    { apiName: 'form', arguments: '{}', identifier: 'cold-stdio', id: 'original', type: 'mcp' },
    { elicitation: { identity, deadline: Date.now() + 1000 } },
  );
  expect(result?.content).toBe('continued');
  const payload = superjson.deserialize(mockElectronIpc.mcp.callTool.mock.calls.at(-1)![0]) as any;
  expect(payload.elicitation).toMatchObject({ identity, relayResult: true });
  expect(lambdaClient.connector.getForRun.query).toHaveBeenCalledWith({
    identifier: 'cold-stdio',
  });
});

const payload = { apiName: 'echo', arguments: '{}', identifier: 'http-mcp' } as ChatToolPayload;
it('keeps awaiting a persisted client invocation after an enqueue ACK is lost', async () => {
  const { lambdaClient } = await import('@/libs/trpc/client');
  vi.mocked(lambdaClient.connector.resolveForRun.query).mockResolvedValueOnce({
    id: 'http-id',
    identifier: 'http-mcp',
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://example.com/mcp',
  } as any);
  vi.mocked(lambdaClient.mcpElicitation.startClientTool.mutate).mockRejectedValueOnce(
    new TypeError('fetch failed after enqueue'),
  );
  vi.mocked(lambdaClient.mcpElicitation.clientToolOutcome.query).mockResolvedValueOnce({
    content: 'committed once',
    success: true,
    state: {},
  });
  const result = await mcpService.invokeMcpToolCall(payload, {
    clientRuntime: true,
    elicitation: {
      identity: {
        apiName: 'echo',
        identifier: 'http-mcp',
        operationId: 'op',
        assistantMessageId: 'assistant',
        toolCallId: 'call_1',
        toolMessageId: 'tool',
      },
      deadline: Date.now() + 1000,
    },
  });
  expect(result).toMatchObject({ content: 'committed once', success: true });
  expect(lambdaClient.mcpElicitation.startClientTool.mutate).toHaveBeenCalledOnce();
});

it('keeps observing a durable execution after a transient outcome read fails without re-enqueueing it', async () => {
  vi.useFakeTimers();
  try {
    const { lambdaClient } = await import('@/libs/trpc/client');
    vi.mocked(lambdaClient.connector.resolveForRun.query).mockResolvedValueOnce({
      id: 'http-id',
      identifier: 'http-mcp',
      isEnabled: true,
      mcpConnectionType: 'http',
      mcpServerUrl: 'https://example.com/mcp',
    } as never);
    vi.mocked(lambdaClient.mcpElicitation.startClientTool.mutate).mockResolvedValueOnce(
      undefined as never,
    );
    vi.mocked(lambdaClient.mcpElicitation.clientToolOutcome.query)
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        content: 'actual committed receipt',
        success: true,
        state: {},
      } as never);
    const result = mcpService.invokeMcpToolCall(payload, {
      clientRuntime: true,
      elicitation: {
        identity: {
          apiName: 'echo',
          identifier: 'http-mcp',
          operationId: 'op',
          assistantMessageId: 'assistant',
          toolCallId: 'call_1',
          toolMessageId: 'tool',
        },
        deadline: Date.now() + 10000,
      },
    });
    const observed = result.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await observed).toMatchObject({
      content: 'actual committed receipt',
      success: true,
    });
    expect(lambdaClient.mcpElicitation.startClientTool.mutate).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

it('keeps cloud MCP on the marketplace lane when client runtime is selected', async () => {
  const { lambdaClient, toolsClient } = await import('@/libs/trpc/client');
  mockPluginSelectors.getInstalledPluginById.mockReturnValue(() => ({
    customParams: { mcp: { type: 'cloud' } },
    manifest: { meta: { title: 'Cloud MCP' }, version: '1' },
  }));
  toolsClient.market.callCloudMcpEndpoint.mutate = vi.fn().mockResolvedValue({
    content: 'cloud result',
    success: true,
    state: { content: [] },
  });
  await expect(
    mcpService.invokeMcpToolCall(
      { ...payload, identifier: 'cloud-mcp' },
      {
        clientRuntime: true,
        topicId: 'topic',
      },
    ),
  ).resolves.toMatchObject({ content: 'cloud result', success: true });
  expect(lambdaClient.mcpElicitation.startClientTool.mutate).not.toHaveBeenCalled();
});
