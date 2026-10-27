import { inspect } from 'node:util';

import type * as LobeConst from '@lobechat/const';
import {
  ProtocolError,
  ProtocolErrorCode,
  SdkError,
  SdkErrorCode,
} from '@modelcontextprotocol/client';
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MCPClient, type MCPClientParams } from '@/libs/mcp';

import { MCPService } from './index';

const environment = vi.hoisted(() => ({ isDesktop: false }));
const debugLog = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof LobeConst>()),
  get isDesktop() {
    return environment.isDesktop;
  },
}));

vi.mock('debug', () => ({ default: () => debugLog }));

// Mock 依赖
vi.mock('@/libs/mcp');

const sensitiveHttpParams = {
  auth: {
    accessToken: 'oauth-access-token-secret',
    clientSecret: 'oauth-client-secret',
    refreshToken: 'oauth-refresh-token-secret',
    token: 'bearer-token-secret',
    type: 'oauth2' as const,
  },
  headers: {
    'Authorization': 'Bearer authorization-header-secret',
    'Cookie': 'session=cookie-header-secret',
    'X-Api-Key': 'custom-header-secret',
  },
  metadata: {
    nested: {
      auth: { token: 'nested-auth-secret' },
      env: { PRIVATE_KEY: 'nested-env-secret' },
      headers: { Cookie: 'nested-cookie-secret' },
    },
  },
  name: 'remote-connector',
  type: 'http' as const,
  url: 'https://url-user:url-password@mcp.example.com/path-token-secret?api_key=url-query-secret#fragment-secret',
} as unknown as MCPClientParams;

const sensitiveValues = [
  'oauth-access-token-secret',
  'oauth-client-secret',
  'oauth-refresh-token-secret',
  'bearer-token-secret',
  'authorization-header-secret',
  'cookie-header-secret',
  'custom-header-secret',
  'nested-auth-secret',
  'nested-env-secret',
  'nested-cookie-secret',
  'url-user',
  'url-password',
  'path-token-secret',
  'url-query-secret',
  'fragment-secret',
  'remote-generated-secret',
];

const expectLogsToBeRedacted = (logOutput: string) => {
  for (const sensitiveValue of sensitiveValues) {
    expect(logOutput).not.toContain(sensitiveValue);
  }
};

describe('MCPService stdio authorization', () => {
  const stdioParams = {
    args: ['serve'],
    command: 'local-mcp',
    name: 'local-connector',
    type: 'stdio' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    environment.isDesktop = false;
    vi.mocked(MCPClient.prototype.listTools).mockResolvedValue([]);
    vi.mocked(MCPClient.prototype.callTool).mockResolvedValue({ content: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    environment.isDesktop = false;
  });

  it('rejects connector tool sync on the web before initializing a stdio client', async () => {
    await expect(new MCPService().listRawTools(stdioParams)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Stdio MCP type is not supported in web environment.',
    });
    expect(MCPClient).not.toHaveBeenCalled();
  });

  it('rejects server-side stdio tool execution without initializing a client', async () => {
    await expect(
      new MCPService().callTool({
        argsStr: '{}',
        clientParams: stdioParams,
        toolName: 'read_file',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(MCPClient).not.toHaveBeenCalled();
  });

  it('keeps stdio available on Desktop', async () => {
    environment.isDesktop = true;

    await expect(new MCPService().listRawTools(stdioParams)).resolves.toEqual([]);
    expect(MCPClient.prototype.initialize).toHaveBeenCalledOnce();
  });

  it('keeps HTTP MCP available on the web', async () => {
    await expect(
      new MCPService().listRawTools({
        name: 'remote-connector',
        type: 'http',
        url: 'https://mcp.example.com',
      }),
    ).resolves.toEqual([]);
    expect(MCPClient.prototype.initialize).toHaveBeenCalledOnce();
  });
});

describe('MCPService log redaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    environment.isDesktop = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      invoke: (service: MCPService) => service.listTools(sensitiveHttpParams),
      operationName: 'listing tools',
    },
    {
      invoke: (service: MCPService) => service.listResources(sensitiveHttpParams),
      operationName: 'listing resources',
    },
    {
      invoke: (service: MCPService) => service.listPrompts(sensitiveHttpParams),
      operationName: 'listing prompts',
    },
    {
      invoke: (service: MCPService) =>
        service.callTool({
          argsStr: '{}',
          clientParams: sensitiveHttpParams,
          toolName: 'read_records',
        }),
      operationName: 'calling tool "read_records"',
    },
  ])('redacts credentials when $operationName fails', async ({ invoke, operationName }) => {
    const service = new MCPService();
    const failure = new Error('Connection failed with remote-generated-secret');
    const mockClient = {
      callTool: vi.fn().mockRejectedValue(failure),
      listPrompts: vi.fn().mockRejectedValue(failure),
      listResources: vi.fn().mockRejectedValue(failure),
      listTools: vi.fn().mockRejectedValue(failure),
    };
    vi.spyOn(service as any, 'getClient').mockResolvedValue(mockClient);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(invoke(service)).rejects.toThrow(TRPCError);

    const logOutput = inspect([debugLog.mock.calls, consoleError.mock.calls], { depth: null });
    expectLogsToBeRedacted(logOutput);
    expect(logOutput).toContain(operationName);
    expect(logOutput).toContain('attempt');
    expect(logOutput).toContain('https://mcp.example.com');
    expect(logOutput).toContain("type: 'http'");
  });

  it('redacts credentials from client initialization failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(MCPClient.prototype.initialize).mockRejectedValueOnce(
      new Error('Initialization failed with remote-generated-secret'),
    );

    await expect(new MCPService().listRawTools(sensitiveHttpParams)).rejects.toThrow(TRPCError);

    const logOutput = inspect([debugLog.mock.calls, consoleError.mock.calls], { depth: null });
    expectLogsToBeRedacted(logOutput);
    expect(logOutput).toContain('https://mcp.example.com');
    expect(logOutput).toContain("name: 'Error'");
  });

  it('redacts stdio environment variables from rejected server operations', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      new MCPService().listRawTools({
        args: ['serve'],
        command: 'local-mcp',
        env: { PRIVATE_KEY: 'stdio-env-secret' },
        name: 'local-connector',
        type: 'stdio',
      }),
    ).rejects.toThrow(TRPCError);

    const logOutput = inspect([debugLog.mock.calls, consoleError.mock.calls], { depth: null });
    expect(logOutput).not.toContain('stdio-env-secret');
    expect(logOutput).toContain("type: 'stdio'");
  });

  it('does not log tool argument or result values', async () => {
    const service = new MCPService();
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        content: [{ text: 'tool-result-secret', type: 'text' }],
      }),
    };
    vi.spyOn(service as any, 'getClient').mockResolvedValue(mockClient);

    await service.callTool({
      argsStr: JSON.stringify({ apiKey: 'tool-argument-secret' }),
      clientParams: sensitiveHttpParams,
      toolName: 'read_records',
    });

    const logOutput = inspect(debugLog.mock.calls, { depth: null });
    expect(logOutput).not.toContain('tool-argument-secret');
    expect(logOutput).not.toContain('tool-result-secret');
    expectLogsToBeRedacted(logOutput);
  });
});

describe('MCPService', () => {
  let mcpService: any;
  let mockClient: any;
  let getClientSpy: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // 动态导入服务实例
    const { mcpService: importedService } = await import('./index');
    mcpService = importedService;

    // 创建 mock 客户端
    mockClient = {
      callTool: vi.fn(),
      listManifests: vi.fn(),
      listPrompts: vi.fn(),
      listResources: vi.fn(),
      listTools: vi.fn(),
    };

    // Mock getClient 方法返回 mock 客户端
    getClientSpy = vi.spyOn(mcpService as any, 'getClient').mockResolvedValue(mockClient);
  });

  describe('manifest descriptions', () => {
    it.each(['My server description'])(
      'keeps stdio descriptions as metadata (%s)',
      async (description) => {
        mockClient.listManifests.mockResolvedValue({
          prompts: undefined,
          resources: undefined,
          tools: [{ inputSchema: { type: 'object' }, name: 'hello' }],
        });

        const manifest = await mcpService.getStdioMcpServerManifest(
          { command: 'test-command', name: 'tools-only' },
          { description },
        );

        expect(manifest.api).toHaveLength(1);
        expect(manifest.meta.description).toBe(description);
      },
    );

    it.each(['My server description'])(
      'keeps HTTP descriptions as metadata (%s)',
      async (description) => {
        mockClient.listTools.mockResolvedValue([]);

        const manifest = await mcpService.getStreamableMcpServerManifest(
          'empty-server',
          'https://mcp.example.com',
          { description },
        );

        expect(manifest.api).toEqual([]);
        expect(manifest.meta.description).toBe(description);
      },
    );
  });

  describe('callTool', () => {
    const mockParams = {
      name: 'test-mcp',
      type: 'stdio' as const,
      command: 'test-command',
      args: ['--test'],
    };

    it('should return MCPToolCallResult when content array is empty', async () => {
      mockClient.callTool.mockResolvedValue({
        content: [],
        isError: false,
      });

      const result = await mcpService.callTool({
        clientParams: mockParams,
        toolName: 'testTool',
        argsStr: '{}',
      });

      expect(result.content).toBe('');
      expect(result.success).toBe(true);
      expect(result.state).toEqual({ content: [], isError: false });
    });

    it('should handle null content', async () => {
      mockClient.callTool.mockResolvedValue({
        content: null,
        isError: false,
      });

      const result = await mcpService.callTool({
        clientParams: mockParams,
        toolName: 'testTool',
        argsStr: '{}',
      });

      expect(result.content).toBe('');
      expect(result.success).toBe(true);
    });

    it('should return JSON string when single element contains valid JSON', async () => {
      const jsonData = { message: 'Hello World', status: 'success' };
      mockClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(jsonData) }],
        isError: false,
      });

      const result = await mcpService.callTool({
        clientParams: mockParams,
        toolName: 'testTool',
        argsStr: '{}',
      });

      expect(result.content).toBe(JSON.stringify(jsonData));
      expect(result.success).toBe(true);
    });

    it('should return plain text when single element contains non-JSON text', async () => {
      const textData = 'Hello World';
      mockClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: textData }],
        isError: false,
      });

      const result = await mcpService.callTool({
        clientParams: mockParams,
        toolName: 'testTool',
        argsStr: '{}',
      });

      expect(result.content).toBe(textData);
      expect(result.success).toBe(true);
      expect(result.state.content).toEqual([{ type: 'text', text: textData }]);
    });

    it('should return empty content when single element has no text', async () => {
      const contentData = [{ type: 'text', text: '' }];
      mockClient.callTool.mockResolvedValue({
        content: contentData,
        isError: false,
      });

      const result = await mcpService.callTool({
        clientParams: mockParams,
        toolName: 'testTool',
        argsStr: '{}',
      });

      expect(result.content).toBe('');
      expect(result.success).toBe(true);
      expect(result.state.content).toEqual(contentData);
    });

    it('should join multiple text elements with double newlines', async () => {
      const multipleContent = [
        { type: 'text', text: 'First message' },
        { type: 'text', text: 'Second message' },
        { type: 'text', text: '{"json": "data"}' },
      ];

      mockClient.callTool.mockResolvedValue({
        content: multipleContent,
        isError: false,
      });

      const result = await mcpService.callTool({
        clientParams: mockParams,
        toolName: 'testTool',
        argsStr: '{}',
      });

      expect(result.content).toBe('First message\n\nSecond message\n\n{"json": "data"}');
      expect(result.success).toBe(true);
      expect(result.state.content).toEqual(multipleContent);
    });

    it('should join two text elements with double newline', async () => {
      const twoContent = [
        { type: 'text', text: 'First message' },
        { type: 'text', text: 'Second message' },
      ];

      mockClient.callTool.mockResolvedValue({
        content: twoContent,
        isError: false,
      });

      const result = await mcpService.callTool({
        clientParams: mockParams,
        toolName: 'testTool',
        argsStr: '{}',
      });

      expect(result.content).toBe('First message\n\nSecond message');
      expect(result.success).toBe(true);
      expect(result.state.content).toEqual(twoContent);
    });

    it('should return error result when isError is true', async () => {
      const errorResult = {
        content: [{ type: 'text', text: 'Error occurred' }],
        isError: true,
      };

      mockClient.callTool.mockResolvedValue(errorResult);

      const result = await mcpService.callTool({
        clientParams: mockParams,
        toolName: 'testTool',
        argsStr: '{}',
      });

      expect(result.content).toBe('Error occurred');
      expect(result.success).toBe(true);
      expect(result.state).toEqual(errorResult);
    });

    it('should throw TRPCError when client throws error', async () => {
      const error = new Error('MCP client error');
      mockClient.callTool.mockRejectedValue(error);

      await expect(
        mcpService.callTool({
          clientParams: mockParams,
          toolName: 'testTool',
          argsStr: '{}',
        }),
      ).rejects.toThrow(TRPCError);
    });

    it('should parse args string correctly', async () => {
      const argsObject = { param1: 'value1', param2: 'value2' };
      const argsString = JSON.stringify(argsObject);

      mockClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'result' }],
        isError: false,
      });

      await mcpService.callTool({
        clientParams: mockParams,
        toolName: 'testTool',
        argsStr: argsString,
      });

      expect(mockClient.callTool).toHaveBeenCalledWith('testTool', argsObject);
    });

    it('should retry with a fresh session when NoValidSessionId error occurs', async () => {
      // First call fails because the cached session is dead (server restarted)
      mockClient.callTool.mockRejectedValueOnce(new Error('NoValidSessionId'));
      // Second call (with skipCache=true) succeeds against a fresh session
      mockClient.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      });

      const result = await mcpService.callTool({
        clientParams: mockParams,
        toolName: 'testTool',
        argsStr: '{}',
      });

      expect(result.content).toBe('ok');
      expect(result.success).toBe(true);
      expect(mockClient.callTool).toHaveBeenCalledTimes(2);
      // Retry must drop the cached client: first attempt skipCache=false, retry skipCache=true
      expect(getClientSpy).toHaveBeenNthCalledWith(1, mockParams, false);
      expect(getClientSpy).toHaveBeenNthCalledWith(2, mockParams, true);
    });

    it('should retry up to 3 times for NoValidSessionId error', async () => {
      mockClient.callTool.mockRejectedValue(new Error('NoValidSessionId'));

      await expect(
        mcpService.callTool({
          clientParams: mockParams,
          toolName: 'testTool',
          argsStr: '{}',
        }),
      ).rejects.toThrow('NoValidSessionId');
      // 1 initial + 3 retries = 4 attempts
      expect(mockClient.callTool).toHaveBeenCalledTimes(4);
    });

    it('should NOT retry tool-level ProtocolError and return it as a failed tool result', async () => {
      const mcpError = new ProtocolError(ProtocolErrorCode.InvalidParams, 'tool blew up');
      mockClient.callTool.mockRejectedValue(mcpError);

      const result = await mcpService.callTool({
        clientParams: mockParams,
        toolName: 'testTool',
        argsStr: '{}',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe(mcpError);
      expect(result.state.isError).toBe(true);
      // ProtocolError is a tool result, not a session error → must not retry
      expect(mockClient.callTool).toHaveBeenCalledTimes(1);
    });

    it.each([SdkErrorCode.RequestTimeout, SdkErrorCode.ConnectionClosed])(
      'returns SDK %s as a failed result without retry',
      async (code) => {
        const error = new SdkError(code, 'transport failed');
        mockClient.callTool.mockRejectedValue(error);
        const result = await mcpService.callTool({
          clientParams: mockParams,
          toolName: 'testTool',
          argsStr: '{}',
        });
        expect(result).toMatchObject({ success: false, error, state: { isError: true } });
        expect(mockClient.callTool).toHaveBeenCalledTimes(1);
      },
    );

    it('should bail immediately on client initialization failure without retrying', async () => {
      // getClient throws (e.g. bad URL/token, stdio spawn error) — not a stale session
      const initError = new Error('Failed to initialize MCP client');
      getClientSpy.mockRejectedValue(initError);

      await expect(
        mcpService.callTool({
          clientParams: mockParams,
          toolName: 'testTool',
          argsStr: '{}',
        }),
      ).rejects.toThrow(TRPCError);
      // Must NOT respawn/re-auth on init failure
      expect(getClientSpy).toHaveBeenCalledTimes(1);
      expect(mockClient.callTool).not.toHaveBeenCalled();
    });
  });

  describe('listTools', () => {
    const mockParams = {
      name: 'test-mcp',
      type: 'stdio' as const,
      command: 'test-command',
      args: ['--test'],
    };

    it('should successfully list tools and transform to LobeChatPluginApi format', async () => {
      const mockTools = [
        {
          name: 'tool1',
          description: 'First test tool',
          inputSchema: {
            type: 'object',
            properties: { param1: { type: 'string' } },
          },
        },
        {
          name: 'tool2',
          description: 'Second test tool',
          inputSchema: {
            type: 'object',
            properties: { param2: { type: 'number' } },
          },
        },
      ];

      mockClient.listTools.mockResolvedValue(mockTools);

      const result = await mcpService.listTools(mockParams);

      expect(mockClient.listTools).toHaveBeenCalled();
      expect(result).toEqual([
        {
          name: 'tool1',
          description: 'First test tool',
          parameters: {
            type: 'object',
            properties: { param1: { type: 'string' } },
          },
        },
        {
          name: 'tool2',
          description: 'Second test tool',
          parameters: {
            type: 'object',
            properties: { param2: { type: 'number' } },
          },
        },
      ]);
    });

    it('should return empty array when no tools available', async () => {
      mockClient.listTools.mockResolvedValue([]);

      const result = await mcpService.listTools(mockParams);

      expect(result).toEqual([]);
    });

    it('should retry with skipCache when NoValidSessionId error occurs (first retry)', async () => {
      const mockTools = [
        {
          name: 'tool1',
          description: 'Test tool',
          inputSchema: { type: 'object' },
        },
      ];

      // First call fails with NoValidSessionId
      mockClient.listTools.mockRejectedValueOnce(new Error('NoValidSessionId'));
      // Second call (with skipCache=true) succeeds
      mockClient.listTools.mockResolvedValueOnce(mockTools);

      const result = await mcpService.listTools(mockParams);

      expect(mockClient.listTools).toHaveBeenCalledTimes(2);
      expect(result).toEqual([
        {
          name: 'tool1',
          description: 'Test tool',
          parameters: { type: 'object' },
        },
      ]);
    });

    it('should retry up to 3 times for NoValidSessionId error', async () => {
      const mockTools = [
        {
          name: 'tool1',
          description: 'Test tool',
          inputSchema: { type: 'object' },
        },
      ];

      // Fail 3 times, succeed on 4th
      mockClient.listTools
        .mockRejectedValueOnce(new Error('NoValidSessionId'))
        .mockRejectedValueOnce(new Error('NoValidSessionId'))
        .mockRejectedValueOnce(new Error('NoValidSessionId'))
        .mockResolvedValueOnce(mockTools);

      const result = await mcpService.listTools(mockParams);

      expect(mockClient.listTools).toHaveBeenCalledTimes(4);
      expect(result).toHaveLength(1);
    });

    it('should throw original error when NoValidSessionId retry exceeds limit', async () => {
      // Fail more than 3 times
      mockClient.listTools.mockRejectedValue(new Error('NoValidSessionId'));

      await expect(mcpService.listTools(mockParams)).rejects.toThrow('NoValidSessionId');
      // async-retry: 1 initial + 3 retries = 4 attempts
      expect(mockClient.listTools).toHaveBeenCalledTimes(4);
    });

    it('should throw TRPCError on other errors without retry', async () => {
      const error = new Error('Connection failed');
      mockClient.listTools.mockRejectedValue(error);

      await expect(mcpService.listTools(mockParams)).rejects.toThrow(TRPCError);
      expect(mockClient.listTools).toHaveBeenCalledTimes(1);
    });

    it('should throw TRPCError with correct error message', async () => {
      const error = new Error('Custom error message');
      mockClient.listTools.mockRejectedValue(error);

      await expect(mcpService.listTools(mockParams)).rejects.toMatchObject({
        message: 'Error listing tools from MCP server: Custom error message',
        code: 'INTERNAL_SERVER_ERROR',
      });
    });
  });

  describe('listResources', () => {
    const mockParams = {
      name: 'test-mcp',
      type: 'stdio' as const,
      command: 'test-command',
      args: ['--test'],
    };

    it('should retry with a fresh session when NoValidSessionId error occurs', async () => {
      const resources = [{ name: 'res1', uri: 'file:///res1' }];
      mockClient.listResources.mockRejectedValueOnce(new Error('NoValidSessionId'));
      mockClient.listResources.mockResolvedValueOnce(resources);

      const result = await mcpService.listResources(mockParams);

      expect(result).toEqual(resources);
      expect(mockClient.listResources).toHaveBeenCalledTimes(2);
      expect(getClientSpy).toHaveBeenNthCalledWith(2, mockParams, true);
    });

    it('should throw TRPCError on other errors without retry', async () => {
      mockClient.listResources.mockRejectedValue(new Error('boom'));

      await expect(mcpService.listResources(mockParams)).rejects.toThrow(TRPCError);
      expect(mockClient.listResources).toHaveBeenCalledTimes(1);
    });
  });

  describe('listPrompts', () => {
    const mockParams = {
      name: 'test-mcp',
      type: 'stdio' as const,
      command: 'test-command',
      args: ['--test'],
    };

    it('should retry with a fresh session when NoValidSessionId error occurs', async () => {
      const prompts = [{ name: 'prompt1' }];
      mockClient.listPrompts.mockRejectedValueOnce(new Error('NoValidSessionId'));
      mockClient.listPrompts.mockResolvedValueOnce(prompts);

      const result = await mcpService.listPrompts(mockParams);

      expect(result).toEqual(prompts);
      expect(mockClient.listPrompts).toHaveBeenCalledTimes(2);
      expect(getClientSpy).toHaveBeenNthCalledWith(2, mockParams, true);
    });

    it('should throw TRPCError on other errors without retry', async () => {
      mockClient.listPrompts.mockRejectedValue(new Error('boom'));

      await expect(mcpService.listPrompts(mockParams)).rejects.toThrow(TRPCError);
      expect(mockClient.listPrompts).toHaveBeenCalledTimes(1);
    });
  });
});
