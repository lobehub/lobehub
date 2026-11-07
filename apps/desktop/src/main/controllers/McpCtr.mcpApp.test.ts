import { getMcpServerFingerprint } from '@lobechat/const/mcpApp';
import { deserializeMcpIpcPayload, serializeMcpIpcPayload } from '@lobechat/utils/mcpIpcPayload';
import { SdkError, SdkErrorCode } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import McpCtr from './McpCtr';

const { mcpClientMocks } = vi.hoisted(() => ({
  mcpClientMocks: vi.fn(),
}));

vi.mock('../libs/mcp/client', () => ({
  MCPClient: class {
    constructor(
      public params: unknown,
      options?: unknown,
    ) {
      return mcpClientMocks(options);
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
  getProtocolEra: vi.fn().mockReturnValue('legacy'),
  getToolUiResourceUri: vi.fn().mockResolvedValue('ui://weather/view'),
  initialize: vi.fn().mockResolvedValue(undefined),
  isToolCallableByApp: vi.fn().mockResolvedValue(true),
  isToolHiddenFromModel: vi.fn().mockResolvedValue(false),
  listResources: vi.fn().mockResolvedValue([]),
  readResource: vi.fn().mockResolvedValue({ contents: [{ text: '<html />', uri: 'ui://x' }] }),
  ...overrides,
});

describe('McpCtr MCP Apps', () => {
  let ctr: McpCtr;

  beforeEach(() => {
    vi.resetAllMocks();
    ctr = new McpCtr(mockApp);
  });

  it('marks results of tools that declare a ui:// view while MCP Apps are on', async () => {
    mcpClientMocks.mockReturnValue(makeClient());

    const result = await ctr.runStdioMcpTool({
      args: '{}',
      env: undefined,
      mcpApps: true,
      params: stdioParams,
      toolName: 'show_weather',
    } as any);

    expect(mcpClientMocks).toHaveBeenCalledWith({ mcpApps: true });
    // With the server the view may be read back from
    expect((result.state as any).mcpApp).toEqual({
      resourceUri: 'ui://weather/view',
      server: await getMcpServerFingerprint({ ...stdioParams, type: 'stdio' }),
    });
  });

  it("neither announces MCP Apps nor looks up views while the user's flag is off", async () => {
    const client = makeClient();
    mcpClientMocks.mockReturnValue(client);

    const result = await ctr.runStdioMcpTool({
      args: '{}',
      env: undefined,
      params: stdioParams,
      toolName: 'show_weather',
    } as any);

    expect(mcpClientMocks).toHaveBeenCalledWith({ mcpApps: false });
    expect(client.getToolUiResourceUri).not.toHaveBeenCalled();
    expect((result.state as any).mcpApp).toBeUndefined();
  });

  it('pools sessions that announce MCP Apps apart from ones that do not', async () => {
    mcpClientMocks.mockImplementation(() => makeClient());
    const run = (mcpApps: boolean) =>
      ctr.runStdioMcpTool({
        args: '{}',
        env: undefined,
        mcpApps,
        params: stdioParams,
        toolName: 'show_weather',
      } as any);

    await run(false);
    await run(true);
    await run(true);

    expect(mcpClientMocks.mock.calls).toEqual([[{ mcpApps: false }], [{ mcpApps: true }]]);
  });

  it("returns a view the tool's own media, not the chat's uploaded copies", async () => {
    const image = { data: 'aGVsbG8=', mimeType: 'image/png', type: 'image' };
    const client = makeClient({
      callTool: vi.fn().mockResolvedValue({ content: [image, { text: 'done', type: 'text' }] }),
    });
    mcpClientMocks.mockReturnValue(client);

    const result = await ctr.runStdioMcpTool({
      args: '{}',
      env: undefined,
      fromApp: true,
      mcpApps: true,
      params: stdioParams,
      toolName: 'snapshot',
    } as any);

    expect(result.success).toBe(true);
    expect((result.state as any).content).toEqual([image, { text: 'done', type: 'text' }]);
    expect(result.content).toBe('done');
  });

  it("refuses a view's call while MCP Apps are off", async () => {
    const client = makeClient();
    mcpClientMocks.mockReturnValue(client);

    const result = await ctr.runStdioMcpTool({
      args: '{}',
      env: undefined,
      fromApp: true,
      params: stdioParams,
      toolName: 'refresh',
    } as any);

    expect(client.callTool).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
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

  it("runs a view's call to a tool visible to the app", async () => {
    const client = makeClient();
    mcpClientMocks.mockReturnValue(client);

    const result = deserializeMcpIpcPayload<any>(
      await ctr.callTool(
        serializeMcpIpcPayload({
          args: {},
          env: undefined,
          fromApp: true,
          mcpApps: true,
          params: stdioParams,
          toolName: 'refresh',
        }),
      ),
    );

    expect(client.isToolCallableByApp).toHaveBeenCalledWith('refresh');
    expect(client.callTool).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it('refuses a model call to a tool only its views may call, and runs it when visibility is unknown', async () => {
    const hidden = makeClient({ isToolHiddenFromModel: vi.fn().mockResolvedValue(true) });
    mcpClientMocks.mockReturnValue(hidden);
    const call = async () =>
      deserializeMcpIpcPayload<any>(
        await ctr.callTool(
          serializeMcpIpcPayload({
            args: {},
            http: { name: 'local', url: 'http://127.0.0.1:3000/mcp' },
            mcpApps: true,
            toolName: 'load_page',
          }),
        ),
      );

    const refused = await call();
    expect(hidden.callTool).not.toHaveBeenCalled();
    expect(refused.success).toBe(false);

    // A failed listing must not stop the model's calls
    const unknown = makeClient({
      isToolHiddenFromModel: vi.fn().mockRejectedValue(new Error('list failed')),
    });
    mcpClientMocks.mockReturnValue(unknown);
    // A fresh controller, so its session is the new client
    ctr = new McpCtr(mockApp);
    const ran = await call();
    expect(ran.success).toBe(true);
  });

  it.each([
    ['kept from views', vi.fn().mockResolvedValue(false)],
    ['of unknown visibility', vi.fn().mockRejectedValue(new Error('list failed'))],
  ])("refuses a view's call to a tool %s without running it", async (_, isToolCallableByApp) => {
    const client = makeClient({ isToolCallableByApp });
    mcpClientMocks.mockReturnValue(client);

    const result = deserializeMcpIpcPayload<any>(
      await ctr.callTool(
        serializeMcpIpcPayload({
          args: {},
          fromApp: true,
          http: { name: 'local', url: 'http://127.0.0.1:3000/mcp' },
          mcpApps: true,
          toolName: 'delete_all',
        }),
      ),
    );

    expect(client.callTool).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.state.isError).toBe(true);
  });

  it('recovers a view call whose session expired during the visibility check', async () => {
    const stale = Object.assign(new Error('session expired'), { name: 'MCPConnectionError' });
    const expired = makeClient({ isToolCallableByApp: vi.fn().mockRejectedValue(stale) });
    const fresh = makeClient();
    mcpClientMocks.mockReturnValueOnce(expired).mockReturnValueOnce(fresh);

    const result = await ctr.runStdioMcpTool({
      args: '{}',
      env: undefined,
      fromApp: true,
      mcpApps: true,
      params: stdioParams,
      toolName: 'refresh',
    } as any);

    // Not taken for a refusal: the session is replaced and the call runs on it
    expect(expired.disconnect).toHaveBeenCalled();
    expect(fresh.callTool).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it("evicts a view call's dead session instead of reusing it for the next call", async () => {
    const dead = makeClient({
      isToolCallableByApp: vi
        .fn()
        .mockRejectedValue(new SdkError(SdkErrorCode.NotConnected, 'Not connected')),
    });
    const fresh = makeClient();
    mcpClientMocks.mockReturnValueOnce(dead).mockReturnValueOnce(fresh);
    const viewCall = () =>
      ctr.runStdioMcpTool({
        args: '{}',
        env: undefined,
        fromApp: true,
        mcpApps: true,
        params: stdioParams,
        toolName: 'refresh',
      } as any);

    await viewCall().catch(() => {});
    expect(dead.disconnect).toHaveBeenCalled();

    await viewCall();
    expect(fresh.callTool).toHaveBeenCalledTimes(1);
  });

  it('does not check visibility for conversation calls', async () => {
    const client = makeClient();
    mcpClientMocks.mockReturnValue(client);

    await ctr.runStdioMcpTool({
      args: '{}',
      env: undefined,
      params: stdioParams,
      toolName: 'show_weather',
    } as any);

    expect(client.isToolCallableByApp).not.toHaveBeenCalled();
  });

  it("falls back to the resource's listing entry for the view's metadata", async () => {
    const csp = { connectDomains: ['https://api.example.com'] };
    mcpClientMocks.mockReturnValue(
      makeClient({
        listResources: vi.fn().mockResolvedValue([{ _meta: { ui: { csp } }, uri: 'ui://x' }]),
        readResource: vi
          .fn()
          .mockResolvedValue({ contents: [{ text: '<html />', uri: 'ui://x' }] }),
      }),
    );

    const result = deserializeMcpIpcPayload<any>(
      (await ctr.readUiResource(
        serializeMcpIpcPayload({ params: stdioParams, uri: 'ui://x' }) as any,
      )) as any,
    );

    expect(result.contents[0]._meta).toEqual({ ui: { csp } });
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
