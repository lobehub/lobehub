import { type ChatToolPayload, type ToolManifest } from '@lobechat/types';
import superjson from 'superjson';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpService } from './mcp';

const mockConstEnv = vi.hoisted(() => ({ isDesktop: false }));

const mockElectronIpc = {
  mcp: {
    callTool: vi.fn(),
    getStreamableMcpServerManifest: vi.fn(),
    getStdioMcpServerManifest: vi.fn(),
    validMcpServerInstallable: vi.fn(),
  },
};

// Mock dependencies
vi.mock('@lobechat/const', () => ({
  CURRENT_VERSION: '1.0.0',
  get isDesktop() {
    return mockConstEnv.isDesktop;
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

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: {
      callTool: {
        mutate: vi.fn(),
      },
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
}));

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

const createConnector = (overrides: Record<string, unknown> = {}) => ({
  credentials: null,
  id: 'connector-1',
  identifier: 'persisted-stdio',
  isEnabled: true,
  mcpConnectionType: 'stdio',
  mcpServerUrl: null,
  mcpStdioConfig: {
    args: ['-y', 'test-mcp-server'],
    command: 'npx',
    env: { API_KEY: 'local-key' },
  },
  metadata: null,
  name: 'Persisted STDIO',
  sourceType: 'custom',
  status: 'connected',
  tools: [
    {
      crudType: 'read',
      description: 'Search locally',
      displayName: null,
      id: 'connector-tool-1',
      inputSchema: { type: 'object' },
      permission: 'auto',
      toolName: 'search',
      userConnectorId: 'connector-1',
    },
  ],
  ...overrides,
});

const createConnectorStoreState = (connectors: ReturnType<typeof createConnector>[]) => ({
  connectors,
  fetchConnectors: vi.fn().mockResolvedValue(undefined),
});

const createToolPayload = (overrides: Partial<ChatToolPayload> = {}): ChatToolPayload => ({
  id: 'connector-tool-call',
  identifier: 'persisted-stdio',
  apiName: 'search',
  arguments: '{"query":"local"}',
  type: 'standalone',
  ...overrides,
});

describe('MCPService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockConstEnv.isDesktop = false;
    mockGetToolStoreState.mockReturnValue({});
  });

  describe('invokeMcpToolCall', () => {
    it('should route a persisted STDIO connector through Desktop IPC only', async () => {
      const { lambdaClient } = await import('@/libs/trpc/client');
      mockConstEnv.isDesktop = true;
      const state = createConnectorStoreState([createConnector()]);
      mockGetToolStoreState.mockReturnValue(state);

      const mockResult = {
        content: 'local result',
        state: { content: [{ text: 'local result', type: 'text' }] },
        success: true,
      };
      vi.mocked(mockElectronIpc.mcp.callTool).mockResolvedValue(
        superjson.serialize(mockResult) as any,
      );

      const result = await mcpService.invokeMcpToolCall(createToolPayload(), {});

      expect(result).toEqual(mockResult);
      expect(state.fetchConnectors).toHaveBeenCalledOnce();
      expect(mockElectronIpc.mcp.callTool).toHaveBeenCalledOnce();
      expect(lambdaClient.connector.callTool.mutate).not.toHaveBeenCalled();
    });

    it('should keep a persisted STDIO connector on the server path on Web', async () => {
      const { lambdaClient } = await import('@/libs/trpc/client');
      mockGetToolStoreState.mockReturnValue({ connectors: [createConnector()] });
      vi.mocked(lambdaClient.connector.callTool.mutate).mockResolvedValue('server result');

      const payload = createToolPayload();
      const result = await mcpService.invokeMcpToolCall(payload, {});

      expect(result).toBe('server result');
      expect(lambdaClient.connector.callTool.mutate).toHaveBeenCalledWith(
        {
          args: payload.arguments,
          identifier: payload.identifier,
          toolName: payload.apiName,
        },
        { signal: undefined },
      );
      expect(mockElectronIpc.mcp.callTool).not.toHaveBeenCalled();
    });

    it('should keep a persisted HTTP connector on the server path on Desktop', async () => {
      const { lambdaClient } = await import('@/libs/trpc/client');
      mockConstEnv.isDesktop = true;
      mockGetToolStoreState.mockReturnValue({
        connectors: [
          createConnector({
            identifier: 'persisted-http',
            mcpConnectionType: 'http',
            mcpServerUrl: 'http://127.0.0.1:3000/mcp',
            mcpStdioConfig: null,
          }),
        ],
      });
      vi.mocked(lambdaClient.connector.callTool.mutate).mockResolvedValue('http result');

      const payload = createToolPayload({ identifier: 'persisted-http' });
      const result = await mcpService.invokeMcpToolCall(payload, {});

      expect(result).toBe('http result');
      expect(lambdaClient.connector.callTool.mutate).toHaveBeenCalledWith(
        {
          args: payload.arguments,
          identifier: payload.identifier,
          toolName: payload.apiName,
        },
        { signal: undefined },
      );
      expect(mockElectronIpc.mcp.callTool).not.toHaveBeenCalled();
    });

    it('should reject a Desktop STDIO connector without stored config', async () => {
      const { lambdaClient } = await import('@/libs/trpc/client');
      mockConstEnv.isDesktop = true;
      mockGetToolStoreState.mockReturnValue(
        createConnectorStoreState([createConnector({ mcpStdioConfig: null })]),
      );

      await expect(mcpService.invokeMcpToolCall(createToolPayload(), {})).rejects.toThrow(
        'Desktop STDIO connector "persisted-stdio" is missing required mcpStdioConfig.command',
      );
      expect(mockElectronIpc.mcp.callTool).not.toHaveBeenCalled();
      expect(lambdaClient.connector.callTool.mutate).not.toHaveBeenCalled();
    });

    it('should reject an unsynced Desktop STDIO tool before IPC', async () => {
      const { lambdaClient } = await import('@/libs/trpc/client');
      mockConstEnv.isDesktop = true;
      mockGetToolStoreState.mockReturnValue(createConnectorStoreState([createConnector()]));

      await expect(
        mcpService.invokeMcpToolCall(createToolPayload({ apiName: 'unknown_tool' }), {}),
      ).rejects.toThrow("Tool 'unknown_tool' is not available on this connector");
      expect(mockElectronIpc.mcp.callTool).not.toHaveBeenCalled();
      expect(lambdaClient.connector.callTool.mutate).not.toHaveBeenCalled();
    });

    it('should reject a disabled Desktop STDIO tool before IPC', async () => {
      const { lambdaClient } = await import('@/libs/trpc/client');
      mockConstEnv.isDesktop = true;
      mockGetToolStoreState.mockReturnValue(
        createConnectorStoreState([
          createConnector({
            tools: [
              {
                crudType: 'read',
                description: 'Search locally',
                displayName: null,
                id: 'connector-tool-1',
                inputSchema: { type: 'object' },
                permission: 'disabled',
                toolName: 'search',
                userConnectorId: 'connector-1',
              },
            ],
          }),
        ]),
      );

      await expect(mcpService.invokeMcpToolCall(createToolPayload(), {})).rejects.toThrow(
        "Tool 'search' is disabled for this connector",
      );
      expect(mockElectronIpc.mcp.callTool).not.toHaveBeenCalled();
      expect(lambdaClient.connector.callTool.mutate).not.toHaveBeenCalled();
    });

    it('should parse Desktop connector args and deserialize the IPC result', async () => {
      mockConstEnv.isDesktop = true;
      mockGetToolStoreState.mockReturnValue(
        createConnectorStoreState([
          createConnector({
            mcpStdioConfig: {
              args: ['server.js', '--stdio'],
              command: 'node',
              env: { NODE_ENV: 'test' },
            },
          }),
        ]),
      );

      const mockResult = {
        content: 'parsed result',
        state: { content: [{ text: 'parsed result', type: 'text' }] },
        success: true,
      };
      vi.mocked(mockElectronIpc.mcp.callTool).mockResolvedValue(
        superjson.serialize(mockResult) as any,
      );

      const result = await mcpService.invokeMcpToolCall(
        createToolPayload({ arguments: '{"query":"parsed","limit":2}' }),
        {},
      );

      const serializedInput = vi.mocked(mockElectronIpc.mcp.callTool).mock.calls[0][0];
      expect(superjson.deserialize(serializedInput as any)).toEqual({
        args: { limit: 2, query: 'parsed' },
        env: { NODE_ENV: 'test' },
        params: {
          args: ['server.js', '--stdio'],
          command: 'node',
          env: { NODE_ENV: 'test' },
          name: 'persisted-stdio',
          type: 'stdio',
        },
        toolName: 'search',
      });
      expect(result).toEqual(mockResult);
    });

    it('should re-read Desktop STDIO permission state before IPC', async () => {
      const { lambdaClient } = await import('@/libs/trpc/client');
      mockConstEnv.isDesktop = true;
      const stale = createConnectorStoreState([createConnector()]);
      const fresh = createConnectorStoreState([
        createConnector({
          tools: [
            {
              crudType: 'read',
              description: 'Search locally',
              displayName: null,
              id: 'connector-tool-1',
              inputSchema: { type: 'object' },
              permission: 'disabled',
              toolName: 'search',
              userConnectorId: 'connector-1',
            },
          ],
        }),
      ]);
      stale.fetchConnectors.mockImplementation(async () => {
        mockGetToolStoreState.mockReturnValue(fresh);
      });
      mockGetToolStoreState.mockReturnValue(stale);

      await expect(mcpService.invokeMcpToolCall(createToolPayload(), {})).rejects.toThrow(
        "Tool 'search' is disabled for this connector",
      );

      expect(stale.fetchConnectors).toHaveBeenCalledOnce();
      expect(mockElectronIpc.mcp.callTool).not.toHaveBeenCalled();
      expect(lambdaClient.connector.callTool.mutate).not.toHaveBeenCalled();
    });

    it('should invoke tool call with installed plugin', async () => {
      const { toolsClient } = await import('@/libs/trpc/client');
      const { discoverService } = await import('./discover');

      const mockPlugin = {
        customParams: {
          mcp: {
            type: 'sse',
            name: 'test-plugin',
            env: { API_KEY: 'test-key' },
          },
        },
        settings: { timeout: 5000 },
        manifest: {
          meta: {
            avatar: '🧪',
            description: 'Test plugin',
            title: 'Test Plugin',
          },
          version: '1.0.0',
        },
      };

      mockPluginSelectors.getInstalledPluginById.mockReturnValue(() => mockPlugin);
      mockPluginSelectors.getCustomPluginById.mockReturnValue(() => null);

      const mockResult = 'test result';
      vi.mocked(toolsClient.mcp.callTool.mutate).mockResolvedValue(mockResult);

      const payload: ChatToolPayload = {
        id: 'tool-call-1',
        identifier: 'test-plugin',
        apiName: 'testMethod',
        arguments: '{"param": "value"}',
        type: 'standalone',
      };

      const result = await mcpService.invokeMcpToolCall(payload, { topicId: 'topic-1' });

      expect(result).toEqual(mockResult);
      expect(toolsClient.mcp.callTool.mutate).toHaveBeenCalledWith(
        {
          args: '{"param": "value"}',
          env: { timeout: 5000 },
          params: {
            type: 'sse',
            name: 'test-plugin',
            env: { API_KEY: 'test-key' },
          },
          meta: {
            customPluginInfo: undefined,
            isCustomPlugin: false,
            sessionId: 'topic-1',
            version: '1.0.0',
          },
          toolName: 'testMethod',
        },
        { signal: undefined },
      );

      // For SSE type, reporting is handled by server-side, frontend should NOT call reportPluginCall
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(discoverService.reportPluginCall).not.toHaveBeenCalled();
    });

    it('should invoke tool call with custom plugin', async () => {
      const { toolsClient } = await import('@/libs/trpc/client');

      const mockCustomPlugin = {
        customParams: {
          mcp: {
            type: 'streamable',
            name: 'custom-plugin',
          },
        },
        manifest: {
          meta: {
            avatar: '🎨',
            description: 'Custom plugin',
            title: 'Custom Plugin',
          },
          version: '2.0.0',
        },
      };

      mockPluginSelectors.getInstalledPluginById.mockReturnValue(() => null);
      mockPluginSelectors.getCustomPluginById.mockReturnValue(() => mockCustomPlugin);

      const mockResult = 'custom result';
      vi.mocked(toolsClient.mcp.callTool.mutate).mockResolvedValue(mockResult);

      const payload: ChatToolPayload = {
        id: 'tool-call-2',
        identifier: 'custom-plugin',
        apiName: 'customMethod',
        arguments: '{}',
        type: 'standalone',
      };

      const result = await mcpService.invokeMcpToolCall(payload, {});

      expect(result).toEqual(mockResult);
      expect(toolsClient.mcp.callTool.mutate).toHaveBeenCalled();
    });

    it('should use toolsClient for stdio plugin when not on desktop', async () => {
      const { toolsClient } = await import('@/libs/trpc/client');

      const mockStdioPlugin = {
        customParams: {
          mcp: {
            type: 'stdio',
            command: 'node',
            args: ['script.js'],
          },
        },
        settings: {},
        manifest: {
          meta: { title: 'Stdio Plugin' },
          version: '1.0.0',
        },
      };

      mockPluginSelectors.getInstalledPluginById.mockReturnValue(() => mockStdioPlugin);
      mockPluginSelectors.getCustomPluginById.mockReturnValue(() => null);

      const mockResult = 'stdio result';
      vi.mocked(toolsClient.mcp.callTool.mutate).mockResolvedValue(mockResult);

      const payload: ChatToolPayload = {
        id: 'tool-call-3',
        identifier: 'stdio-plugin',
        apiName: 'execute',
        arguments: '{"input": "test"}',
        type: 'standalone',
      };

      const result = await mcpService.invokeMcpToolCall(payload, {});

      expect(result).toEqual(mockResult);
      expect(toolsClient.mcp.callTool.mutate).toHaveBeenCalled();
    });

    it('should return undefined when plugin is not found', async () => {
      mockPluginSelectors.getInstalledPluginById.mockReturnValue(() => null);
      mockPluginSelectors.getCustomPluginById.mockReturnValue(() => null);

      const payload: ChatToolPayload = {
        id: 'tool-call-4',
        identifier: 'non-existent-plugin',
        apiName: 'method',
        arguments: '{}',
        type: 'standalone',
      };

      const result = await mcpService.invokeMcpToolCall(payload, {});

      expect(result).toBeUndefined();
    });

    it('should handle tool call errors and report them', async () => {
      const { toolsClient } = await import('@/libs/trpc/client');
      const { discoverService } = await import('./discover');

      const mockPlugin = {
        customParams: {
          mcp: {
            type: 'sse',
          },
        },
        manifest: {
          meta: { title: 'Error Plugin' },
          version: '1.0.0',
        },
      };

      mockPluginSelectors.getInstalledPluginById.mockReturnValue(() => mockPlugin);
      mockPluginSelectors.getCustomPluginById.mockReturnValue(() => null);

      const mockError = new Error('Tool call failed');
      vi.mocked(toolsClient.mcp.callTool.mutate).mockRejectedValue(mockError);

      const payload: ChatToolPayload = {
        id: 'tool-call-5',
        identifier: 'error-plugin',
        apiName: 'failMethod',
        arguments: '{}',
        type: 'standalone',
      };

      await expect(mcpService.invokeMcpToolCall(payload, {})).rejects.toThrow('Tool call failed');

      // For SSE type, reporting is handled by server-side, frontend should NOT call reportPluginCall
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(discoverService.reportPluginCall).not.toHaveBeenCalled();
    });

    it('should call toolsClient.market.callCloudMcpEndpoint for cloud type and not report from frontend', async () => {
      const { discoverService } = await import('./discover');
      const { toolsClient } = await import('@/libs/trpc/client');

      // Use cloud type which now reports from server-side
      const mockPlugin = {
        customParams: {
          mcp: { type: 'cloud' },
        },
        manifest: {
          meta: { title: 'Cloud Plugin' },
          version: '1.0.0',
        },
      };

      mockPluginSelectors.getInstalledPluginById.mockReturnValue(() => mockPlugin);
      mockPluginSelectors.getCustomPluginById.mockReturnValue(() => null);

      // Mock the toolsClient for cloud type
      const mockResult = {
        content: 'response data',
        state: {
          content: [{ text: 'response data', type: 'text' as const }],
        },
        success: true,
      };
      vi.mocked(toolsClient.market.callCloudMcpEndpoint.mutate).mockResolvedValue(mockResult);

      const payload: ChatToolPayload = {
        id: 'tool-call-6',
        identifier: 'cloud-plugin',
        apiName: 'cloudMethod',
        arguments: '{"key": "value"}',
        type: 'standalone',
      };

      const result = await mcpService.invokeMcpToolCall(payload, { topicId: 'topic-123' });

      expect(result).toEqual(mockResult);
      expect(toolsClient.market.callCloudMcpEndpoint.mutate).toHaveBeenCalledWith({
        apiParams: { key: 'value' },
        identifier: 'cloud-plugin',
        meta: {
          customPluginInfo: undefined,
          isCustomPlugin: false,
          sessionId: 'topic-123',
          version: '1.0.0',
        },
        toolName: 'cloudMethod',
      });

      // Wait for async reporting
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Cloud type should NOT report from frontend (handled server-side)
      expect(discoverService.reportPluginCall).not.toHaveBeenCalled();
    });

    it('should handle abort signal', async () => {
      const { toolsClient } = await import('@/libs/trpc/client');

      const mockPlugin = {
        customParams: {
          mcp: { type: 'sse' },
        },
        manifest: {
          meta: { title: 'Abort Test Plugin' },
          version: '1.0.0',
        },
      };

      mockPluginSelectors.getInstalledPluginById.mockReturnValue(() => mockPlugin);
      mockPluginSelectors.getCustomPluginById.mockReturnValue(() => null);

      const abortController = new AbortController();
      const mockResult = 'result';
      vi.mocked(toolsClient.mcp.callTool.mutate).mockResolvedValue(mockResult);

      const payload: ChatToolPayload = {
        id: 'tool-call-7',
        identifier: 'abort-plugin',
        apiName: 'method',
        arguments: '{}',
        type: 'standalone',
      };

      const result = await mcpService.invokeMcpToolCall(payload, {
        signal: abortController.signal,
      });

      expect(toolsClient.mcp.callTool.mutate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          signal: abortController.signal,
        }),
      );
      expect(result).toEqual(mockResult);
    });

    it('should pass meta to server for custom plugin', async () => {
      const { toolsClient } = await import('@/libs/trpc/client');

      const mockCustomPlugin = {
        customParams: {
          mcp: {
            type: 'streamable',
            command: 'npm run plugin',
          },
        },
        manifest: {
          meta: {
            avatar: '🔧',
            description: 'Custom tool description',
            title: 'Custom Tool',
          },
          version: '3.0.0',
        },
      };

      mockPluginSelectors.getInstalledPluginById.mockReturnValue(() => null);
      mockPluginSelectors.getCustomPluginById.mockReturnValue(() => mockCustomPlugin);

      vi.mocked(toolsClient.mcp.callTool.mutate).mockResolvedValue('ok');

      const payload: ChatToolPayload = {
        id: 'tool-call-8',
        identifier: 'custom-tool',
        apiName: 'customAction',
        arguments: '{}',
        type: 'standalone',
      };

      await mcpService.invokeMcpToolCall(payload, { topicId: 'topic-123' });

      // Verify meta is passed to server
      expect(toolsClient.mcp.callTool.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: {
            customPluginInfo: {
              avatar: '🔧',
              description: 'Custom tool description',
              name: 'Custom Tool',
            },
            isCustomPlugin: true,
            sessionId: 'topic-123',
            version: '3.0.0',
          },
        }),
        expect.anything(),
      );
    });
  });

  describe('getStreamableMcpServerManifest', () => {
    it('should use toolsClient for streamable URLs when not on desktop', async () => {
      const { toolsClient } = await import('@/libs/trpc/client');
      const mockManifest: ToolManifest = {
        identifier: 'streamable-server',
        version: '1',
        meta: { title: 'Streamable MCP Server', avatar: '🌐' },
        api: [
          {
            name: 'test',
            description: 'Test API',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };
      vi.mocked(toolsClient.mcp.getStreamableMcpServerManifest.query).mockResolvedValue(
        mockManifest,
      );

      const params = {
        identifier: 'streamable-server',
        url: 'http://127.0.0.1:3000/manifest',
        auth: { type: 'none' as const },
      };

      const result = await mcpService.getStreamableMcpServerManifest(params);

      expect(result).toEqual(mockManifest);
      expect(toolsClient.mcp.getStreamableMcpServerManifest.query).toHaveBeenCalledWith(params, {
        signal: undefined,
      });
    });

    it('should use toolsClient for remote URLs', async () => {
      const { toolsClient } = await import('@/libs/trpc/client');
      const mockManifest: ToolManifest = {
        identifier: 'remote-server',
        version: '1',
        meta: { title: 'Remote MCP Server', avatar: '🌍' },
        api: [
          {
            name: 'remoteTest',
            description: 'Remote Test API',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };
      vi.mocked(toolsClient.mcp.getStreamableMcpServerManifest.query).mockResolvedValue(
        mockManifest,
      );

      const params = {
        identifier: 'remote-server',
        url: 'https://api.example.com/manifest',
        auth: { type: 'bearer' as const, token: 'abc123' },
        headers: { 'X-Custom': 'header' },
      };

      const abortController = new AbortController();
      const result = await mcpService.getStreamableMcpServerManifest(
        params,
        abortController.signal,
      );

      expect(result).toEqual(mockManifest);
      expect(toolsClient.mcp.getStreamableMcpServerManifest.query).toHaveBeenCalledWith(params, {
        signal: abortController.signal,
      });
    });

    it('should handle different URL formats correctly', async () => {
      const { toolsClient } = await import('@/libs/trpc/client');
      const mockManifest: ToolManifest = {
        identifier: 'server',
        version: '1',
        meta: { title: 'URL Test Server', avatar: '🔗' },
        api: [
          {
            name: 'urlTest',
            description: 'URL Test API',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };
      vi.mocked(toolsClient.mcp.getStreamableMcpServerManifest.query).mockResolvedValue(
        mockManifest,
      );

      const params = {
        identifier: 'server',
        url: 'http://localhost:8080/manifest',
        auth: { type: 'none' as const },
      };

      const result = await mcpService.getStreamableMcpServerManifest(params);

      expect(result).toEqual(mockManifest);
      expect(toolsClient.mcp.getStreamableMcpServerManifest.query).toHaveBeenCalled();
    });

    it('should handle OAuth2 authentication', async () => {
      const { toolsClient } = await import('@/libs/trpc/client');
      const mockManifest: ToolManifest = {
        identifier: 'oauth-server',
        version: '1',
        meta: { title: 'OAuth Server', avatar: '🔐' },
        api: [
          {
            name: 'oauthTest',
            description: 'OAuth Test API',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };
      vi.mocked(toolsClient.mcp.getStreamableMcpServerManifest.query).mockResolvedValue(
        mockManifest,
      );

      const params = {
        identifier: 'oauth-server',
        url: 'https://api.oauth.com/manifest',
        auth: {
          type: 'oauth2' as const,
          accessToken: 'access_token_123',
        },
        metadata: {
          avatar: '🔐',
          description: 'OAuth secured API',
          name: 'OAuth API',
        },
      };

      const result = await mcpService.getStreamableMcpServerManifest(params);

      expect(result).toEqual(mockManifest);
      expect(toolsClient.mcp.getStreamableMcpServerManifest.query).toHaveBeenCalledWith(
        params,
        expect.any(Object),
      );
    });
  });

  describe('getStdioMcpServerManifest', () => {
    it('should call ipc mcp.getStdioMcpServerManifest with stdio parameters', async () => {
      const mockManifest: ToolManifest = {
        identifier: 'stdio-server',
        version: '1',
        meta: { title: 'Stdio Server', avatar: '📦' },
        api: [
          {
            name: 'stdioTest',
            description: 'Stdio Test API',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };
      vi.mocked(mockElectronIpc.mcp.getStdioMcpServerManifest).mockResolvedValue(
        superjson.serialize(mockManifest) as any,
      );

      const stdioParams = {
        command: 'node',
        args: ['server.js', '--port', '3000'],
        env: { NODE_ENV: 'production', API_KEY: 'secret' },
        name: 'stdio-server',
      };

      const metadata = {
        avatar: '📦',
        description: 'Stdio API',
        name: 'Stdio Server',
      };

      const result = await mcpService.getStdioMcpServerManifest(stdioParams, metadata);

      expect(result).toEqual(mockManifest);
      const callArg = vi.mocked(mockElectronIpc.mcp.getStdioMcpServerManifest).mock.calls[0][0];
      expect(superjson.deserialize(callArg as any)).toEqual({ ...stdioParams, metadata });
    });

    it('should handle abort signal for stdio manifest', async () => {
      const mockManifest: ToolManifest = {
        identifier: 'python-server',
        version: '1',
        meta: { title: 'Stdio Server', avatar: '🐍' },
        api: [
          {
            name: 'pythonTest',
            description: 'Python Test API',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };
      vi.mocked(mockElectronIpc.mcp.getStdioMcpServerManifest).mockResolvedValue(
        superjson.serialize(mockManifest) as any,
      );

      const stdioParams = {
        command: 'python',
        args: ['app.py'],
        name: 'python-server',
      };

      const abortController = new AbortController();
      await mcpService.getStdioMcpServerManifest(stdioParams, undefined, abortController.signal);

      // IPC client does not support AbortSignal yet
      const callArg = vi.mocked(mockElectronIpc.mcp.getStdioMcpServerManifest).mock.calls[0][0];
      expect(superjson.deserialize(callArg as any)).toEqual({
        ...stdioParams,
        metadata: undefined,
      });
    });

    it('should work without optional parameters', async () => {
      const mockManifest: ToolManifest = {
        identifier: 'npm-server',
        version: '1',
        meta: { title: 'Simple Server', avatar: '📦' },
        api: [
          {
            name: 'npmTest',
            description: 'NPM Test API',
            parameters: { type: 'object', properties: {} },
          },
        ],
      };
      vi.mocked(mockElectronIpc.mcp.getStdioMcpServerManifest).mockResolvedValue(
        superjson.serialize(mockManifest) as any,
      );

      const stdioParams = {
        command: 'npm',
        name: 'npm-server',
      };

      const result = await mcpService.getStdioMcpServerManifest(stdioParams);

      expect(result).toEqual(mockManifest);
      const callArg = vi.mocked(mockElectronIpc.mcp.getStdioMcpServerManifest).mock.calls[0][0];
      expect(superjson.deserialize(callArg as any)).toEqual({
        ...stdioParams,
        metadata: undefined,
      });
    });
  });

  describe('checkInstallation', () => {
    it('should check MCP plugin installation status', async () => {
      const mockInstallResult = {
        platform: 'linux',
        success: true,
        packageInstalled: true,
      };
      vi.mocked(mockElectronIpc.mcp.validMcpServerInstallable).mockResolvedValue(
        superjson.serialize(mockInstallResult) as any,
      );

      const manifest = {
        identifier: 'test-plugin',
        meta: { title: 'Test Plugin' },
        version: '1.0.0',
        deploymentOptions: [
          {
            type: 'stdio',
            command: 'npx',
            args: ['-y', 'test-plugin'],
          },
        ],
      };

      const result = await mcpService.checkInstallation(manifest as any);

      expect(result).toEqual(mockInstallResult);
      const callArg = vi.mocked(mockElectronIpc.mcp.validMcpServerInstallable).mock.calls[0][0];
      expect(superjson.deserialize(callArg as any)).toEqual({
        deploymentOptions: manifest.deploymentOptions,
      });
    });

    it('should handle installation check with abort signal', async () => {
      const mockInstallResult = {
        platform: 'linux',
        success: false,
        packageInstalled: false,
        systemDependencies: [
          { name: 'node', installed: false, meetRequirement: false },
          { name: 'npm', installed: false, meetRequirement: false },
        ],
      };
      vi.mocked(mockElectronIpc.mcp.validMcpServerInstallable).mockResolvedValue(
        superjson.serialize(mockInstallResult) as any,
      );

      const manifest = {
        identifier: 'complex-plugin',
        meta: { title: 'Complex Plugin' },
        version: '2.0.0',
        deploymentOptions: [
          {
            type: 'sse',
            url: 'https://plugin.example.com',
          },
        ],
      };

      const abortController = new AbortController();
      const result = await mcpService.checkInstallation(manifest as any, abortController.signal);

      expect(result).toEqual(mockInstallResult);
      // IPC client does not support AbortSignal yet
      const callArg = vi.mocked(mockElectronIpc.mcp.validMcpServerInstallable).mock.calls[0][0];
      expect(superjson.deserialize(callArg as any)).toEqual({
        deploymentOptions: manifest.deploymentOptions,
      });
    });

    it('should handle multiple deployment options', async () => {
      const mockInstallResult = {
        platform: 'linux',
        success: true,
        packageInstalled: true,
        isRecommended: true,
      };
      vi.mocked(mockElectronIpc.mcp.validMcpServerInstallable).mockResolvedValue(
        superjson.serialize(mockInstallResult) as any,
      );

      const manifest = {
        identifier: 'multi-deploy-plugin',
        meta: { title: 'Multi Deploy Plugin' },
        version: '3.0.0',
        deploymentOptions: [
          {
            type: 'stdio',
            command: 'node',
            args: ['index.js'],
          },
          {
            type: 'streamable',
            url: 'https://api.example.com',
          },
          {
            type: 'sse',
            url: 'https://sse.example.com',
          },
        ],
      };

      const result = await mcpService.checkInstallation(manifest as any);

      expect(result).toEqual(mockInstallResult);
      const callArg = vi.mocked(mockElectronIpc.mcp.validMcpServerInstallable).mock.calls[0][0];
      expect(superjson.deserialize(callArg as any)).toEqual({
        deploymentOptions: manifest.deploymentOptions,
      });
    });
  });
});
