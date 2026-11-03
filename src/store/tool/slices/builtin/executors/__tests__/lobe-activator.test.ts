/**
 * Tests for Lobe Tools Executor (activateTools discovery allowlist)
 */
import { Md5 } from 'ts-md5';
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
const { activatorExecutor } = await import('../lobe-activator');
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

describe('lobe-activator executor discovery allowlist', () => {
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

    const result = await activatorExecutor.invoke(
      'activateTools',
      {
        identifiers: ['web-browsing', 'internal-admin'],
        reason: 'Use web browsing to answer the current request.',
      },
      { messageId: 'msg-1', operationId: 'op-1' },
    );

    expect(result.success).toBe(true);

    const state = result.state as any;
    const activatedIds = state.activatedTools?.map((t: any) => t.identifier) ?? [];

    expect(activatedIds).toContain('web-browsing');
    expect(activatedIds).not.toContain('internal-admin');
  }, 10_000);

  it('should reject all identifiers when none are discoverable', async () => {
    const hiddenTool = makeBuiltinTool('secret-tool', false);

    mockGetState.mockReturnValue({
      builtinTools: [hiddenTool],
      installedPlugins: [],
    });

    mockAvailableToolsForDiscovery.mockReturnValue([]);

    const result = await activatorExecutor.invoke(
      'activateTools',
      {
        identifiers: ['secret-tool'],
        reason: 'Use the secret tool to answer the current request.',
      },
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

    const result = await activatorExecutor.invoke(
      'activateTools',
      {
        identifiers: ['community-plugin'],
        reason: 'Use the plugin to answer the current request.',
      },
      { messageId: 'msg-1', operationId: 'op-1' },
    );

    expect(result.success).toBe(true);

    const state = result.state as any;
    const activatedIds = state.activatedTools?.map((t: any) => t.identifier) ?? [];
    expect(activatedIds).toContain('community-plugin');
  });

  it('should activate a hashed wire name via the client discoverable list', async () => {
    // Codex P2 on PR #20791: the client executor did not implement
    // `listToolManifests`, so `MD5HASH_x____MD5HASH_y` names had no manifests
    // to resolve against and returned Not found even when the tool was
    // discoverable. The list must be served from the same discovery
    // allowlist as `getToolManifests`.
    const tool = makeBuiltinTool('long-named-plugin');

    mockGetState.mockReturnValue({
      builtinTools: [tool],
      installedPlugins: [],
    });

    mockAvailableToolsForDiscovery.mockReturnValue([
      { description: 'desc', identifier: 'long-named-plugin', name: 'long-named-plugin' },
    ]);

    const wireName = `MD5HASH_${Md5.hashStr('long-named-plugin').toString().slice(0, 12)}____run`;

    const result = await activatorExecutor.invoke(
      'activateTools',
      { identifiers: [wireName], reason: 'Activate via hashed wire name.' },
      { messageId: 'msg-1', operationId: 'op-1' },
    );

    expect(result.success).toBe(true);

    const state = result.state as any;
    const activatedIds = state.activatedTools?.map((t: any) => t.identifier) ?? [];
    expect(activatedIds).toContain('long-named-plugin');
  }, 10_000);

  it('should activate a bare API name via the client discoverable list', async () => {
    // Companion regression for the same P2: separator-free API names need
    // the full list too — the identifier-keyed probe returns nothing for
    // them.
    const tool = makeBuiltinTool('web-browsing');

    mockGetState.mockReturnValue({
      builtinTools: [tool],
      installedPlugins: [],
    });

    mockAvailableToolsForDiscovery.mockReturnValue([
      { description: 'desc', identifier: 'web-browsing', name: 'web-browsing' },
    ]);

    const result = await activatorExecutor.invoke(
      'activateTools',
      { identifiers: ['run'], reason: 'Activate via bare API name.' },
      { messageId: 'msg-1', operationId: 'op-1' },
    );

    expect(result.success).toBe(true);

    const state = result.state as any;
    const activatedIds = state.activatedTools?.map((t: any) => t.identifier) ?? [];
    expect(activatedIds).toContain('web-browsing');
  }, 10_000);

  it('should activate a cached Composio server tool while the plugin replica is still pending', async () => {
    // Codex P2 on PR #20791: discovery exposes connected Composio servers
    // straight from the cached `composioServers` replica, but manifest lookup
    // only probed builtin tools, installed plugins and LobeHub Skill servers.
    // During the startup window before the independent plugin fetch lands,
    // `getInstalledPluginById` misses and activation failed with `Not found`.
    mockGetState.mockReturnValue({
      builtinTools: [],
      composioServers: [
        {
          identifier: 'composio-github',
          label: 'GitHub',
          status: 'active',
          tools: [{ description: 'Create an issue', inputSchema: {}, name: 'create_issue' }],
        },
      ],
      installedPlugins: [],
    });

    mockAvailableToolsForDiscovery.mockReturnValue([
      { description: 'GitHub tools', identifier: 'composio-github', name: 'GitHub' },
    ]);

    const result = await activatorExecutor.invoke(
      'activateTools',
      {
        identifiers: ['composio-github____create_issue'],
        reason: 'Use the Composio GitHub connection.',
      },
      { messageId: 'msg-1', operationId: 'op-1' },
    );

    expect(result.success).toBe(true);

    const state = result.state as any;
    const activated = state.activatedTools?.find((t: any) => t.identifier === 'composio-github');
    expect(activated).toBeDefined();
    expect(activated.name).toBe('GitHub');
    expect(activated.apiCount).toBe(1);
  }, 10_000);

  it('should let a connected LobeHub Skill server own a conflicting Composio identifier', async () => {
    // Discovery's ownership rule: when a connector identifier has both legacy
    // Composio and current LobeHub connections, the LobeHub Skill server owns
    // the single visible entry. Manifest resolution must mirror that order.
    mockGetState.mockReturnValue({
      builtinTools: [],
      composioServers: [
        {
          identifier: 'notion',
          label: 'Legacy Composio Notion',
          status: 'active',
          tools: [{ description: 'Legacy api', inputSchema: {}, name: 'legacy_api' }],
        },
      ],
      installedPlugins: [],
      lobehubSkillServers: [
        {
          identifier: 'notion',
          name: 'Notion',
          status: 'connected',
          tools: [{ description: 'LobeHub api', name: 'lobehub_api' }],
        },
      ],
    });

    mockAvailableToolsForDiscovery.mockReturnValue([
      { description: 'Notion tools', identifier: 'notion', name: 'Notion' },
    ]);

    const result = await activatorExecutor.invoke(
      'activateTools',
      {
        identifiers: ['notion____lobehub_api'],
        reason: 'Use the LobeHub Notion connection.',
      },
      { messageId: 'msg-1', operationId: 'op-1' },
    );

    expect(result.success).toBe(true);

    const state = result.state as any;
    const activatedIds = state.activatedTools?.map((t: any) => t.identifier) ?? [];
    expect(activatedIds).toContain('notion');
  }, 10_000);
});
