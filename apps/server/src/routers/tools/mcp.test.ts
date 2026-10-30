// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpRouter } from './mcp';

const { mockCallTool, mockMcpAppEnabled, mockReadUiResource } = vi.hoisted(() => ({
  mockCallTool: vi.fn(),
  mockMcpAppEnabled: vi.fn(),
  mockReadUiResource: vi.fn(),
}));

vi.mock('@/server/services/mcp/featureGate', () => ({ isMcpAppEnabled: mockMcpAppEnabled }));

vi.mock('./_helpers', () => ({ scheduleToolCallReport: vi.fn() }));

// Not a connector: the call skips the connector permission gate
vi.mock('@/database/models/connector', () => ({
  ConnectorModel: vi.fn(function () {
    return { queryByIdentifiers: vi.fn().mockResolvedValue([]) };
  }),
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn(function (opts: any) {
    return opts.next({ ctx: opts.ctx });
  }),
  telemetry: vi.fn(function (opts: any) {
    return opts.next({ ctx: opts.ctx });
  }),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/server/services/mcp', () => ({
  mcpService: { callTool: mockCallTool, readUiResource: mockReadUiResource },
}));

describe('tools mcpRouter.callTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([true, false])('passes the caller mcp_app flag (%s) to the MCP call', async (enabled) => {
    mockMcpAppEnabled.mockResolvedValue(enabled);
    mockCallTool.mockResolvedValue({ content: 'ok', state: { content: [] }, success: true });
    const caller = mcpRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

    await caller.callTool({
      args: '{}',
      params: { name: 'weather', type: 'http', url: 'https://mcp.example.com/mcp' },
      toolName: 'forecast',
    });

    expect(mockMcpAppEnabled).toHaveBeenCalledWith('user-1');
    expect(mockCallTool).toHaveBeenCalledWith(expect.objectContaining({ mcpApp: enabled }));
  });
});

describe('tools mcpRouter.readUiResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMcpAppEnabled.mockResolvedValue(true);
  });

  it('refuses to read a view while the mcp_app flag is off', async () => {
    mockMcpAppEnabled.mockResolvedValue(false);
    const caller = mcpRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

    await expect(
      caller.readUiResource({
        params: { name: 'weather', type: 'http', url: 'https://mcp.example.com/mcp' },
        uri: 'ui://weather/view.html',
      }),
    ).rejects.toHaveProperty('code', 'FORBIDDEN');

    expect(mockMcpAppEnabled).toHaveBeenCalledWith('user-1');
    expect(mockReadUiResource).not.toHaveBeenCalled();
  });

  it('reads the view through the MCP service, credentials in the mutation input', async () => {
    const caller = mcpRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);
    const view = { contents: [{ text: '<html />', uri: 'ui://weather/view.html' }] };
    mockReadUiResource.mockResolvedValue(view);
    const params = {
      auth: { token: 'secret', type: 'bearer' as const },
      name: 'weather-demo',
      type: 'http' as const,
      url: 'https://mcp.example.com/mcp',
    };

    await expect(caller.readUiResource({ params, uri: 'ui://weather/view.html' })).resolves.toEqual(
      view,
    );

    expect(mockReadUiResource).toHaveBeenCalledWith(params, 'ui://weather/view.html');
  });
});
