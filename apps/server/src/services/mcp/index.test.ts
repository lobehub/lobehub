import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock 依赖
vi.mock('@/libs/mcp');

describe('MCPService', () => {
  let mcpService: any;
  let mockClient: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // 动态导入服务实例
    const { mcpService: importedService } = await import('./index');
    mcpService = importedService;

    // 创建 mock 客户端
    mockClient = {
      callTool: vi.fn(),
      listTools: vi.fn(),
    };

    // Mock getClient 方法返回 mock 客户端
    vi.spyOn(mcpService as any, 'getClient').mockResolvedValue(mockClient);
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
});
