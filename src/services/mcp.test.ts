import { type ChatToolPayload, type ToolManifest } from '@lobechat/types';
import superjson from 'superjson';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpService } from './mcp';

const mockElectronIpc = {
  mcp: {
    callTool: vi.fn(),
    getStreamableMcpServerManifest: vi.fn(),
    getStdioMcpServerManifest: vi.fn(),
    validMcpServerInstallable: vi.fn(),
  },
};

const environment = vi.hoisted(() => ({
  isDesktop: false,
  deviceGatewayConfigured: undefined as boolean | undefined,
}));

vi.mock('@/store/serverConfig/store', () => ({
  getServerConfigStoreState: () => ({
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
        list: { query: vi.fn().mockResolvedValue([]) },
        listByAgent: { query: vi.fn().mockResolvedValue([]) },
        callTool: { mutate: vi.fn() },
        getForEdit: { query: vi.fn() },
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

describe('MCPService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    environment.isDesktop = false;
    environment.deviceGatewayConfigured = undefined;
    mockGetToolStoreState.mockReturnValue({});
  });

  describe('invokeMcpToolCall', () => {
    it('resolves a server-dispatched stdio connector before the settings store is initialized', async () => {
      environment.isDesktop = true;
      environment.deviceGatewayConfigured = false;
      const { lambdaClient } = await import('@/libs/trpc/client');
      vi.mocked(lambdaClient.connector.list.query).mockResolvedValueOnce([
        { id: 'fresh', identifier: 'cold-stdio', isEnabled: true, mcpConnectionType: 'stdio' },
      ] as any);
      vi.mocked(lambdaClient.connector.getForEdit.query).mockResolvedValueOnce({
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
      const payload = superjson.deserialize(
        mockElectronIpc.mcp.callTool.mock.calls.at(-1)![0],
      ) as any;
      expect(payload.elicitation).toMatchObject({ identity, relayResult: true });
      expect(lambdaClient.connector.getForEdit.query).toHaveBeenCalledWith({ id: 'fresh' });
    });

    describe('HTTP connector connection failures', () => {
      const payload = {
        apiName: 'echo',
        arguments: '{}',
        identifier: 'http-mcp',
      } as ChatToolPayload;

      beforeEach(() => {
        mockGetToolStoreState.mockReturnValue({
          connectors: [
            {
              id: 'http-id',
              identifier: 'http-mcp',
              isEnabled: true,
              mcpConnectionType: 'http',
              mcpServerUrl: 'https://example.com/mcp',
            },
          ],
        });
      });

      it('keeps awaiting a persisted client invocation after an enqueue ACK is lost', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        vi.mocked(lambdaClient.connector.list.query).mockResolvedValueOnce([
          {
            id: 'http-id',
            identifier: 'http-mcp',
            isEnabled: true,
            mcpConnectionType: 'http',
            mcpServerUrl: 'https://example.com/mcp',
          },
        ] as any);
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
          vi.mocked(lambdaClient.connector.list.query).mockResolvedValueOnce([
            {
              id: 'http-id',
              identifier: 'http-mcp',
              isEnabled: true,
              mcpConnectionType: 'http',
              mcpServerUrl: 'https://example.com/mcp',
            },
          ] as never);
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

      it.each(['AUTHORIZATION_ERROR', 'INITIALIZATION_TIMEOUT', 'CONNECTION_FAILED'])(
        'preserves readable %s as a failed tool result',
        async (type) => {
          const { lambdaClient } = await import('@/libs/trpc/client');
          const error = Object.assign(new Error('Reconnect this MCP in connector settings.'), {
            data: { errorData: { type } },
          });
          vi.mocked(lambdaClient.connector.callTool.mutate).mockRejectedValue(error);
          await expect(mcpService.invokeMcpToolCall(payload, {})).resolves.toMatchObject({
            content: error.message,
            error: { message: error.message },
            success: false,
            state: { isError: true },
          });
        },
      );

      it.each(['UNAUTHORIZED', 'FORBIDDEN'])(
        'keeps unrelated %s errors on their original path',
        async (code) => {
          const { lambdaClient } = await import('@/libs/trpc/client');
          const error = Object.assign(new Error(code), { data: { code } });
          vi.mocked(lambdaClient.connector.callTool.mutate).mockRejectedValue(error);
          await expect(mcpService.invokeMcpToolCall(payload, {})).rejects.toBe(error);
        },
      );
    });

    describe('stdio connectors', () => {
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

      beforeEach(async () => {
        environment.isDesktop = true;
        environment.deviceGatewayConfigured = false;
        mockGetToolStoreState.mockReturnValue({ connectors: [connector] });
        const { lambdaClient } = await import('@/libs/trpc/client');
        vi.mocked(lambdaClient.connector.getForEdit.query).mockResolvedValue(detail as never);
      });

      it('executes through local IPC with fresh configuration when no gateway is configured', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const result = {
          content: 'local result',
          state: { content: [{ type: 'text', text: 'local result' }] },
          success: true,
        };
        mockElectronIpc.mcp.callTool.mockResolvedValue(superjson.serialize(result));

        await expect(mcpService.invokeMcpToolCall(payload, {})).resolves.toEqual(result);
        expect(superjson.deserialize(mockElectronIpc.mcp.callTool.mock.calls[0][0])).toEqual({
          args: { path: 'test.txt' },
          env: detail.mcpStdioConfig.env,
          params: { command: 'node', args: ['mcp.js'], name: payload.identifier, type: 'stdio' },
          toolName: 'read_file',
        });
        expect(lambdaClient.connector.callTool.mutate).not.toHaveBeenCalled();
      });

      it.each([
        { desktop: true, gateway: true },
        { desktop: true, gateway: undefined },
        { desktop: false, gateway: false },
      ])(
        'preserves the server route for desktop=$desktop gateway=$gateway',
        async ({ desktop, gateway }) => {
          environment.isDesktop = desktop;
          environment.deviceGatewayConfigured = gateway;
          const { lambdaClient } = await import('@/libs/trpc/client');
          const result = {
            content: 'server result',
            state: { content: [{ type: 'text', text: 'server result' }] },
            success: true,
          };
          vi.mocked(lambdaClient.connector.callTool.mutate).mockResolvedValue(result as never);

          await expect(mcpService.invokeMcpToolCall(payload, {})).resolves.toEqual(result);
          expect(lambdaClient.connector.getForEdit.query).not.toHaveBeenCalled();
          expect(mockElectronIpc.mcp.callTool).not.toHaveBeenCalled();
        },
      );

      it.each([
        { ...detail, isEnabled: false },
        { ...detail, tools: [] },
        { ...detail, tools: [{ toolName: 'read_file', permission: 'disabled' }] },
      ])('rejects a newly disabled connector or unavailable tool before IPC', async (current) => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        vi.mocked(lambdaClient.connector.getForEdit.query).mockResolvedValue(current as never);

        await expect(mcpService.invokeMcpToolCall(payload, {})).rejects.toThrow();
        expect(mockElectronIpc.mcp.callTool).not.toHaveBeenCalled();
        expect(lambdaClient.connector.callTool.mutate).not.toHaveBeenCalled();
      });

      it('does not execute when the protected configuration read is denied', async () => {
        const { lambdaClient } = await import('@/libs/trpc/client');
        vi.mocked(lambdaClient.connector.getForEdit.query).mockRejectedValue(
          new Error('FORBIDDEN'),
        );

        await expect(mcpService.invokeMcpToolCall(payload, {})).rejects.toThrow('FORBIDDEN');
        expect(mockElectronIpc.mcp.callTool).not.toHaveBeenCalled();
      });
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

    it.each([false, true])(
      'keeps cloud MCP on its market endpoint with clientRuntime=%s',
      async (clientRuntime) => {
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

        const result = await mcpService.invokeMcpToolCall(payload, {
          topicId: 'topic-123',
          clientRuntime,
        });

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
      },
    );

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
