/**
 * Tests for Lobe Tools Executor (activateTools discovery allowlist)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock getToolStoreState
const mockGetState = vi.fn();
vi.mock('@/store/tool', () => ({
  getToolStoreState: () => mockGetState(),
}));

// Mock toolSelectors.availableToolsForDiscovery
const mockAvailableToolsForDiscovery = vi.fn();
vi.mock('@/store/tool/selectors/tool', () => ({
  toolSelectors: {
    availableToolsForDiscovery: (s: any) => mockAvailableToolsForDiscovery(s),
  },
}));

// Import after mocks
const { toolsActivatorExecutor } = await import('../lobe-tools');

const makeBuiltinTool = (identifier: string, discoverable?: boolean) => ({
  discoverable,
  identifier,
  manifest: {
    api: [{ description: `${identifier} api`, name: 'run' }],
    meta: { avatar: '🔧', description: `${identifier} desc`, title: identifier },
    systemRole: `You are ${identifier}`,
  },
});

const makePlugin = (identifier: string) => ({
  identifier,
  manifest: {
    api: [{ description: `${identifier} api`, name: 'execute' }],
    meta: { avatar: '🔌', description: `${identifier} desc`, title: identifier },
    systemRole: `Plugin ${identifier}`,
  },
});

describe('lobe-tools executor discovery allowlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should only return manifests for discoverable tools', async () => {
    const discoverableTool = makeBuiltinTool('web-browsing');
    const hiddenTool = makeBuiltinTool('internal-admin', false);

    mockGetState.mockReturnValue({
      builtinTools: [discoverableTool, hiddenTool],
      installedPlugins: [],
    });

    // Only web-browsing is discoverable
    mockAvailableToolsForDiscovery.mockReturnValue([
      { description: 'desc', identifier: 'web-browsing', name: 'web-browsing' },
    ]);

    const result = await toolsActivatorExecutor.invoke(
      'activateTools',
      { identifiers: ['web-browsing', 'internal-admin'] },
      { messageId: 'msg-1', operationId: 'op-1' },
    );

    expect(result.success).toBe(true);

    const state = result.state as any;
    const activatedIds = state.activatedTools?.map((t: any) => t.identifier) ?? [];

    expect(activatedIds).toContain('web-browsing');
    expect(activatedIds).not.toContain('internal-admin');
  });

  it('should reject all identifiers when none are discoverable', async () => {
    const hiddenTool = makeBuiltinTool('secret-tool', false);

    mockGetState.mockReturnValue({
      builtinTools: [hiddenTool],
      installedPlugins: [],
    });

    mockAvailableToolsForDiscovery.mockReturnValue([]);

    const result = await toolsActivatorExecutor.invoke(
      'activateTools',
      { identifiers: ['secret-tool'] },
      { messageId: 'msg-1', operationId: 'op-1' },
    );

    expect(result.success).toBe(true);

    const state = result.state as any;
    const activatedIds = state.activatedTools?.map((t: any) => t.identifier) ?? [];
    expect(activatedIds).toHaveLength(0);
  });

  it('should allow discoverable plugins', async () => {
    const plugin = makePlugin('community-plugin');

    mockGetState.mockReturnValue({
      builtinTools: [],
      installedPlugins: [plugin],
    });

    mockAvailableToolsForDiscovery.mockReturnValue([
      { description: 'desc', identifier: 'community-plugin', name: 'community-plugin' },
    ]);

    const result = await toolsActivatorExecutor.invoke(
      'activateTools',
      { identifiers: ['community-plugin'] },
      { messageId: 'msg-1', operationId: 'op-1' },
    );

    expect(result.success).toBe(true);

    const state = result.state as any;
    const activatedIds = state.activatedTools?.map((t: any) => t.identifier) ?? [];
    expect(activatedIds).toContain('community-plugin');
  });
});
