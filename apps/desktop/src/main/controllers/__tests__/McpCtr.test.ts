import { deserializeMcpIpcPayload } from '@lobechat/utils/mcpIpcPayload';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import McpCtr from '../McpCtr';

const mockMcpClient = {
  callTool: vi.fn(),
  disconnect: vi.fn(),
  initialize: vi.fn(),
};

const MockMCPClient = vi.fn(function MockMCPClient() {
  return mockMcpClient;
});

vi.mock('../../libs/mcp/client', () => ({
  MCPClient: MockMCPClient,
  MCPConnectionError: class MCPConnectionError extends Error {
    stderrLogs: string[] = [];
  },
}));

vi.mock('@/services/fileSrv', () => ({
  default: class FileService {},
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

describe('McpCtr local HTTP calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMcpClient.callTool.mockResolvedValue({
      content: [{ text: 'tool result', type: 'text' }],
    });
  });

  it('dispatches HTTP callTool IPC payloads to the HTTP MCP client', async () => {
    const controller = new McpCtr({ getService: vi.fn(() => ({})) } as any);
    const result = await controller.callTool({
      json: {
        args: {},
        env: undefined,
        params: {
          name: 'local-server',
          type: 'http',
          url: 'http://127.0.0.1:8765/mcp',
        },
        toolName: 'appHelp',
      },
    });

    expect(deserializeMcpIpcPayload(result)).toEqual({
      content: 'tool result',
      state: { content: [{ text: 'tool result', type: 'text' }] },
      success: true,
    });
    expect(MockMCPClient).toHaveBeenCalledWith({
      name: 'local-server',
      type: 'http',
      url: 'http://127.0.0.1:8765/mcp',
    });
    expect(mockMcpClient.callTool).toHaveBeenCalledWith('appHelp', {});
  });
});
