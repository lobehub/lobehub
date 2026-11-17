// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpRouter } from './mcp';

const { mockCallTool, mockGetStreamableManifest, mockMcpAppsEnabled, mockReadUiResource } =
  vi.hoisted(() => ({
    mockCallTool: vi.fn(),
    mockGetStreamableManifest: vi.fn(),
    mockMcpAppsEnabled: vi.fn(),
    mockReadUiResource: vi.fn(),
  }));

vi.mock('@/server/services/mcp/featureGate', () => ({ isMcpAppsEnabled: mockMcpAppsEnabled }));

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
  mcpService: {
    callTool: mockCallTool,
    getStreamableMcpServerManifest: mockGetStreamableManifest,
    readUiResource: mockReadUiResource,
  },
}));

describe('tools mcpRouter.callTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([true, false])(
    'passes the caller mcp_apps flag (%s) to the MCP call',
    async (enabled) => {
      mockMcpAppsEnabled.mockResolvedValue(enabled);
      mockCallTool.mockResolvedValue({ content: 'ok', state: { content: [] }, success: true });
      const caller = mcpRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

      await caller.callTool({
        args: '{}',
        params: { name: 'weather', type: 'http', url: 'https://mcp.example.com/mcp' },
        toolName: 'forecast',
      });

      expect(mockMcpAppsEnabled).toHaveBeenCalledWith('user-1');
      expect(mockCallTool).toHaveBeenCalledWith(expect.objectContaining({ mcpApps: enabled }));
    },
  );

  it.each([true, undefined])(
    'passes whether a view made the call (%s) to the MCP call',
    async (fromApp) => {
      mockMcpAppsEnabled.mockResolvedValue(true);
      mockCallTool.mockResolvedValue({ content: 'ok', state: { content: [] }, success: true });
      const caller = mcpRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

      await caller.callTool({
        args: '{}',
        fromApp,
        params: { name: 'weather', type: 'http', url: 'https://mcp.example.com/mcp' },
        toolName: 'forecast',
      });

      expect(mockCallTool).toHaveBeenCalledWith(expect.objectContaining({ fromApp }));
    },
  );
});

describe('tools mcpRouter.getStreamableMcpServerManifest', () => {
  it.each([true, false])("discovers under the caller's mcp_apps flag (%s)", async (enabled) => {
    mockMcpAppsEnabled.mockResolvedValue(enabled);
    mockGetStreamableManifest.mockResolvedValue({ api: [] });
    const caller = mcpRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

    await caller.getStreamableMcpServerManifest({
      identifier: 'srv',
      url: 'https://mcp.example.com/mcp',
    });

    expect(mockMcpAppsEnabled).toHaveBeenCalledWith('user-1');
    expect(mockGetStreamableManifest).toHaveBeenCalledWith(
      'srv',
      'https://mcp.example.com/mcp',
      undefined,
      undefined,
      undefined,
      { mcpApps: enabled },
    );
  });
});

describe('tools mcpRouter.readUiResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMcpAppsEnabled.mockResolvedValue(true);
  });

  it('refuses to read a view while the mcp_apps flag is off', async () => {
    mockMcpAppsEnabled.mockResolvedValue(false);
    const caller = mcpRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);

    await expect(
      caller.readUiResource({
        params: { name: 'weather', type: 'http', url: 'https://mcp.example.com/mcp' },
        uri: 'ui://weather/view.html',
      }),
    ).rejects.toHaveProperty('code', 'FORBIDDEN');

    expect(mockMcpAppsEnabled).toHaveBeenCalledWith('user-1');
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
