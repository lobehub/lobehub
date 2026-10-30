import { type ChatToolPayload, type ToolManifest } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpService } from './mcp';

const mockElectronIpc = {
  mcp: {
    callTool: vi.fn(),
    getStreamableMcpServerManifest: vi.fn(),
  },
};

const mockGetToolStoreState = vi.fn();
const mockPluginSelectors = {
  getCustomPluginById: vi.fn(),
  getInstalledPluginById: vi.fn(),
};

vi.mock('@lobechat/const', () => ({
  CURRENT_VERSION: '1.0.0',
  isDesktop: true,
}));

vi.mock('@lobechat/utils', () => ({
  isLocalOrPrivateUrl: vi.fn((url: string) => url.includes('127.0.0.1')),
  safeParseJSON: vi.fn((value: string) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }),
}));

vi.mock('@/libs/trpc/client', () => ({
  toolsClient: {
    market: { callCloudMcpEndpoint: { mutate: vi.fn() } },
    mcp: {
      callTool: { mutate: vi.fn() },
      getStreamableMcpServerManifest: { query: vi.fn() },
    },
  },
}));

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => mockElectronIpc,
}));

vi.mock('./discover', () => ({
  discoverService: {
    reportPluginCall: vi.fn(),
    safeInjectMPToken: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/store/tool/store', () => ({
  getToolStoreState: () => mockGetToolStoreState(),
}));

vi.mock('@/store/tool/selectors', () => ({
  pluginSelectors: mockPluginSelectors,
}));

describe('MCPService desktop HTTP routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToolStoreState.mockReturnValue({});
    mockPluginSelectors.getCustomPluginById.mockReturnValue(() => null);
  });

  it('keeps local HTTP manifest sync and tool calls in the Electron process', async () => {
    const manifest: ToolManifest = {
      api: [{ description: 'Test tool', name: 'appHelp', parameters: { type: 'object' } }],
      identifier: 'local-server',
      meta: { title: 'Local server' },
      version: '1',
    };
    const toolResult = {
      content: 'tool result',
      state: { content: [{ text: 'tool result', type: 'text' as const }] },
      success: true,
    };
    mockElectronIpc.mcp.getStreamableMcpServerManifest.mockResolvedValue({ json: manifest });
    mockElectronIpc.mcp.callTool.mockResolvedValue({ json: toolResult });

    const params = {
      auth: { type: 'none' as const },
      identifier: 'local-server',
      url: 'http://127.0.0.1:8765/mcp',
    };
    await expect(mcpService.getStreamableMcpServerManifest(params)).resolves.toEqual(manifest);

    const plugin = {
      customParams: { mcp: { ...params, type: 'http' as const } },
      manifest: { meta: { title: 'Local server' }, version: '1.0.0' },
      settings: {},
    };
    mockPluginSelectors.getInstalledPluginById.mockReturnValue(() => plugin);

    const payload: ChatToolPayload = {
      apiName: 'appHelp',
      arguments: '{}',
      id: 'tool-call-1',
      identifier: 'local-server',
      type: 'standalone',
    };
    await expect(mcpService.invokeMcpToolCall(payload, {})).resolves.toEqual(toolResult);

    expect(mockElectronIpc.mcp.callTool).toHaveBeenCalledTimes(1);
    expect((await import('@/libs/trpc/client')).toolsClient.mcp.callTool.mutate).not.toHaveBeenCalled();
  });
});
