import { deserializeMcpIpcPayload, serializeMcpIpcPayload } from '@lobechat/utils/mcpIpcPayload';
import { SdkError, SdkErrorCode } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import McpCtr from '../McpCtr';

const { mcpClientMocks } = vi.hoisted(() => ({
  mcpClientMocks: vi.fn(),
}));

vi.mock('../../libs/mcp/client', () => ({
  MCPClient: class {
    constructor(public params: unknown) {
      return mcpClientMocks();
    }
  },
  MCPConnectionError: class extends Error {
    name = 'MCPConnectionError';
    stderrLogs: string[] = [];
  },
}));

const mockApp = { getService: vi.fn(() => null) } as unknown as App;

const stdioParams = { args: ['--stdio'], command: 'weather-mcp', name: 'weather' };

const makeClient = (overrides: Record<string, unknown> = {}) => ({
  callTool: vi.fn().mockResolvedValue({ content: [{ text: 'sunny', type: 'text' }] }),
  disconnect: vi.fn().mockResolvedValue(undefined),
  getToolUiResourceUri: vi.fn().mockResolvedValue('ui://weather/view'),
  initialize: vi.fn().mockResolvedValue(undefined),
  readResource: vi.fn().mockResolvedValue({ contents: [{ text: '<html />', uri: 'ui://x' }] }),
  ...overrides,
});

describe('McpCtr MCP Apps', () => {
  let ctr: McpCtr;

  beforeEach(() => {
    vi.resetAllMocks();
    ctr = new McpCtr(mockApp);
  });

  it('marks results of tools that declare a ui:// view', async () => {
    mcpClientMocks.mockReturnValue(makeClient());

    const result = await ctr.runStdioMcpTool({
      args: '{}',
      env: undefined,
      params: stdioParams,
      toolName: 'show_weather',
    } as any);

    expect((result.state as any).mcpApp).toEqual({ resourceUri: 'ui://weather/view' });
  });

  it('still runs the tool when the view lookup fails', async () => {
    const client = makeClient({
      getToolUiResourceUri: vi.fn().mockRejectedValue(new Error('list failed')),
    });
    mcpClientMocks.mockReturnValue(client);

    const result = await ctr.runStdioMcpTool({
      args: '{}',
      env: undefined,
      params: stdioParams,
      toolName: 'show_weather',
    } as any);

    expect(client.callTool).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect((result.state as any).mcpApp).toBeUndefined();
  });

  it('reads ui:// resources over IPC and refuses other URIs', async () => {
    const client = makeClient();
    mcpClientMocks.mockReturnValue(client);

    const result = await ctr.readUiResource(
      serializeMcpIpcPayload({ env: undefined, params: stdioParams, uri: 'ui://x' }) as any,
    );
    expect(deserializeMcpIpcPayload(result as any)).toEqual({
      contents: [{ text: '<html />', uri: 'ui://x' }],
    });

    await expect(
      ctr.readUiResource(
        serializeMcpIpcPayload({ env: undefined, params: stdioParams, uri: 'file:///x' }) as any,
      ),
    ).rejects.toThrow('ui://');
    expect(client.readResource).toHaveBeenCalledTimes(1);
  });

  it('reads views of local-network http servers', async () => {
    const client = makeClient();
    mcpClientMocks.mockReturnValue(client);

    await ctr.readUiResource(
      serializeMcpIpcPayload({
        http: { name: 'local', url: 'http://127.0.0.1:3000/mcp' },
        uri: 'ui://x',
      }) as any,
    );

    expect(client.readResource).toHaveBeenCalledWith('ui://x');
  });

  it('runs tool calls of local-network http servers over IPC', async () => {
    const client = makeClient();
    mcpClientMocks.mockReturnValue(client);

    const result = await ctr.callTool(
      serializeMcpIpcPayload({
        args: { city: 'Paris' },
        http: { name: 'local', url: 'http://127.0.0.1:3000/mcp' },
        toolName: 'show_weather',
      }) as any,
    );

    expect(client.callTool).toHaveBeenCalledWith('show_weather', { city: 'Paris' });
    expect((deserializeMcpIpcPayload(result as any) as any).success).toBe(true);
  });

  it('evicts a dead pooled session and retries the read on a fresh one', async () => {
    const dead = makeClient({
      readResource: vi
        .fn()
        .mockRejectedValue(new SdkError(SdkErrorCode.NotConnected, 'Not connected')),
    });
    const fresh = makeClient();
    mcpClientMocks.mockReturnValueOnce(dead).mockReturnValueOnce(fresh);

    const result = await ctr.readUiResource(
      serializeMcpIpcPayload({ params: stdioParams, uri: 'ui://x' }) as any,
    );

    expect(deserializeMcpIpcPayload(result as any)).toEqual({
      contents: [{ text: '<html />', uri: 'ui://x' }],
    });
    expect(dead.disconnect).toHaveBeenCalled();

    // the fresh session stays pooled for the next read
    await ctr.readUiResource(serializeMcpIpcPayload({ params: stdioParams, uri: 'ui://x' }) as any);
    expect(fresh.readResource).toHaveBeenCalledTimes(2);
  });

  it('does not retry application errors', async () => {
    const client = makeClient({
      readResource: vi.fn().mockRejectedValue(new Error('Resource not found')),
    });
    mcpClientMocks.mockReturnValue(client);

    await expect(
      ctr.readUiResource(serializeMcpIpcPayload({ params: stdioParams, uri: 'ui://x' }) as any),
    ).rejects.toThrow('Resource not found');
    expect(client.readResource).toHaveBeenCalledTimes(1);
  });
});
