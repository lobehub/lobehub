import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposioServerStatus } from '@/store/tool/slices/composioStore/types';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import type { IAgentService, IDiscoverService } from '../types';
import { AgentManagerRuntime } from './index';

/**
 * installPlugin branches: Composio, LobeHub Skill (both with OAuth windows),
 * MCP marketplace and the thrown-error path. Every store call goes through one
 * shared object per store so a test can assert what was written.
 */
const mocks = vi.hoisted(() => ({
  agentState: {
    agentMap: {} as Record<string, unknown>,
    internal_dispatchAgentMap: vi.fn(),
    optimisticUpdateAgentConfig: vi.fn(),
  },
  agentConfig: { plugins: [] as unknown[] },
  composioServers: [] as unknown[],
  installedPlugin: null as unknown,
  isPluginInstalled: false,
  lobehubServers: [] as unknown[],
  resolveConnector: vi.fn(),
  toolState: {
    checkLobehubSkillStatus: vi.fn(),
    createComposioConnection: vi.fn(),
    getLobehubSkillAuthorizeUrl: vi.fn(),
    installMCPPlugin: vi.fn(),
    refreshComposioConnectionStatus: vi.fn(),
    refreshPlugins: vi.fn(),
  },
  userId: 'user-1' as string | undefined,
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveConnectorCatalogItem: mocks.resolveConnector,
}));
vi.mock('@/store/agent', () => ({ getAgentStoreState: () => mocks.agentState }));
vi.mock('@/store/agent/selectors/selectors', () => ({
  agentSelectors: { getAgentConfigById: () => () => mocks.agentConfig },
}));
vi.mock('@/store/aiInfra', () => ({ getAiInfraStoreState: vi.fn() }));
vi.mock('@/store/tool', () => ({ getToolStoreState: () => mocks.toolState }));
vi.mock('@/store/tool/selectors', () => ({
  builtinToolSelectors: { metaList: () => [] },
  composioStoreSelectors: { getServers: () => mocks.composioServers },
  lobehubSkillStoreSelectors: { getServers: () => mocks.lobehubServers },
  pluginSelectors: {
    getInstalledPluginById: () => () => mocks.installedPlugin,
    isPluginInstalled: () => () => mocks.isPluginInstalled,
  },
}));
vi.mock('@/store/user', () => ({ getUserStoreState: () => ({}) }));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userId: () => mocks.userId },
}));

const agentService = { getAgentConfigById: vi.fn() } as unknown as IAgentService;
const runtime = () =>
  new AgentManagerRuntime({ agentService, discoverService: {} as IDiscoverService });

const composio = { appSlug: 'NOTION', label: 'Notion', serverType: 'composio' };
const lobehub = { id: 'linear', label: 'Linear' };

const install = (identifier: string, source: 'market' | 'official' = 'official') =>
  runtime().installPlugin('agent-1', { identifier, source });

/** Stub window.open with a popup that is already closed when first checked. */
const openClosedPopup = () =>
  vi.spyOn(window, 'open').mockReturnValue({ closed: true } as unknown as Window);

/** Run an install that waits on the OAuth popup, ticking past the 500ms close check. */
const installThroughPopup = async (identifier: string) => {
  const pending = install(identifier);
  await vi.advanceTimersByTimeAsync(500);
  return pending;
};

const enabledPinned = (identifier: string) =>
  expect(mocks.agentState.optimisticUpdateAgentConfig).toHaveBeenCalledWith('agent-1', {
    plugins: [{ identifier, mode: 'pinned' }],
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agentState.agentMap = { 'agent-1': {} };
  mocks.agentConfig.plugins = [];
  mocks.composioServers = [];
  mocks.lobehubServers = [];
  mocks.installedPlugin = null;
  mocks.isPluginInstalled = false;
  mocks.userId = 'user-1';
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('installPlugin · Composio', () => {
  beforeEach(() => {
    mocks.resolveConnector.mockReturnValue({ serverType: composio, type: 'composio' });
  });

  it('enables an already active connection', async () => {
    mocks.composioServers = [{ identifier: 'notion', status: ComposioServerStatus.ACTIVE }];

    const result = await install('notion');

    expect(result).toMatchObject({
      content: 'Successfully enabled Composio tool: Notion',
      state: { installed: true, isComposio: true, serverStatus: 'connected' },
      success: true,
    });
    enabledPinned('notion');
  });

  it('enables a pending connection once its OAuth popup completes', async () => {
    vi.useFakeTimers();
    openClosedPopup();
    mocks.composioServers = [
      {
        identifier: 'notion',
        redirectUrl: 'https://auth',
        status: ComposioServerStatus.PENDING_AUTH,
      },
    ];
    mocks.toolState.refreshComposioConnectionStatus.mockImplementation(async () => {
      mocks.composioServers = [{ identifier: 'notion', status: ComposioServerStatus.ACTIVE }];
    });

    const result = await installThroughPopup('notion');

    expect(window.open).toHaveBeenCalledWith('https://auth', '_blank', 'width=600,height=700');
    expect(result).toMatchObject({
      content: 'Successfully connected and enabled Composio tool: Notion',
      success: true,
    });
    enabledPinned('notion');
  });

  it('reports a pending connection without a redirect URL as failed authorization', async () => {
    mocks.composioServers = [{ identifier: 'notion', status: ComposioServerStatus.PENDING_AUTH }];

    const result = await install('notion');

    expect(result).toMatchObject({
      state: { installed: false, serverStatus: 'pending_auth' },
      success: false,
    });
    expect(result.content).toContain('OAuth authorization was cancelled or failed');
    expect(mocks.agentState.optimisticUpdateAgentConfig).not.toHaveBeenCalled();
  });

  it('refuses to create a connection without a signed-in user', async () => {
    mocks.userId = undefined;

    const result = await install('notion');

    expect(result).toMatchObject({ error: { type: 'AuthRequired' }, success: false });
    expect(mocks.toolState.createComposioConnection).not.toHaveBeenCalled();
  });

  it('enables a newly created connection that is already active', async () => {
    mocks.toolState.createComposioConnection.mockResolvedValue({
      identifier: 'notion',
      status: ComposioServerStatus.ACTIVE,
    });

    const result = await install('notion');

    expect(mocks.toolState.createComposioConnection).toHaveBeenCalledWith({
      appSlug: 'NOTION',
      identifier: 'notion',
      label: 'Notion',
    });
    expect(mocks.toolState.refreshComposioConnectionStatus).toHaveBeenCalledWith('notion');
    expect(result).toMatchObject({ state: { serverStatus: 'connected' }, success: true });
    enabledPinned('notion');
  });

  it('reports a ComposioError when the connection cannot be created', async () => {
    mocks.toolState.createComposioConnection.mockResolvedValue(undefined);

    const result = await install('notion');

    expect(result).toMatchObject({
      content: 'Failed to connect Composio tool: Notion',
      error: { type: 'ComposioError' },
      success: false,
    });
  });
});

describe('installPlugin · LobeHub Skill', () => {
  beforeEach(() => {
    mocks.resolveConnector.mockReturnValue({ provider: lobehub, type: 'lobehub' });
  });

  it('fails without an authorize URL, passing the web callback as redirect', async () => {
    mocks.toolState.getLobehubSkillAuthorizeUrl.mockResolvedValue({});

    const result = await install('linear');

    expect(mocks.toolState.getLobehubSkillAuthorizeUrl).toHaveBeenCalledWith('linear', {
      redirectUri: `${window.location.origin}/oauth/callback/success?provider=linear`,
    });
    expect(result).toMatchObject({
      state: { installed: false, isLobehubSkill: true, serverStatus: 'not_connected' },
      success: false,
    });
    expect(result.content).toContain('no authorization URL is available');
  });

  it.each([
    {
      connected: true,
      content: 'Successfully connected and enabled LobehubSkill provider: Linear',
      success: true,
    },
    {
      connected: false,
      content:
        'OAuth authorization was cancelled or failed for LobehubSkill provider: Linear. Please try again.',
      success: false,
    },
  ])('resolves the OAuth popup by status (connected=$connected)', async (c) => {
    vi.useFakeTimers();
    openClosedPopup();
    mocks.toolState.getLobehubSkillAuthorizeUrl.mockResolvedValue({ authorizeUrl: 'https://a' });
    mocks.toolState.checkLobehubSkillStatus.mockResolvedValue({
      status: c.connected ? LobehubSkillStatus.CONNECTED : 'not_connected',
    });

    const result = await installThroughPopup('linear');

    expect(result).toMatchObject({ content: c.content, success: c.success });
    expect(mocks.agentState.optimisticUpdateAgentConfig).toHaveBeenCalledTimes(c.connected ? 1 : 0);
  });

  it('resolves from the callback page message before the popup closes', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as unknown as Window);
    mocks.toolState.getLobehubSkillAuthorizeUrl.mockResolvedValue({ authorizeUrl: 'https://a' });
    mocks.toolState.checkLobehubSkillStatus.mockResolvedValue({
      status: LobehubSkillStatus.CONNECTED,
    });

    const pending = install('linear');
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { provider: 'linear', type: 'LOBEHUB_SKILL_AUTH_SUCCESS' },
        origin: window.location.origin,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(await pending).toMatchObject({ success: true });
  });
});

describe('installPlugin · market', () => {
  it('enables an already installed plugin without reinstalling it', async () => {
    mocks.isPluginInstalled = true;
    mocks.installedPlugin = { manifest: { meta: { title: 'Weather' } } };

    const result = await install('weather', 'market');

    expect(result).toMatchObject({
      content: 'Plugin "Weather" is already installed. Enabled for current agent.',
      state: { pluginName: 'Weather' },
      success: true,
    });
    expect(mocks.toolState.installMCPPlugin).not.toHaveBeenCalled();
    enabledPinned('weather');
  });

  it('reports a cancelled install without enabling it', async () => {
    mocks.toolState.installMCPPlugin.mockResolvedValue(false);

    const result = await install('weather', 'market');

    expect(result).toMatchObject({ state: { installed: false }, success: false });
    expect(result.content).toContain('Installation was cancelled or configuration is needed');
    expect(mocks.agentState.optimisticUpdateAgentConfig).not.toHaveBeenCalled();
  });

  it('loads an agent that is not in the store before enabling the plugin', async () => {
    mocks.agentState.agentMap = {};
    mocks.isPluginInstalled = true;
    vi.mocked(agentService.getAgentConfigById).mockResolvedValue({ plugins: [] } as any);

    await install('weather', 'market');

    expect(agentService.getAgentConfigById).toHaveBeenCalledWith('agent-1');
    expect(mocks.agentState.internal_dispatchAgentMap).toHaveBeenCalledWith('agent-1', {
      plugins: [],
    });
  });

  it('turns an async install failure into a failed result instead of rejecting', async () => {
    mocks.toolState.installMCPPlugin.mockRejectedValue(new Error('network down'));

    const result = await install('weather', 'market');

    expect(result).toMatchObject({
      content: 'Failed to install plugin: network down',
      state: { error: 'network down', installed: false, pluginId: 'weather' },
      success: false,
    });
  });

  it('turns a thrown error into a failed result that keeps the plugin state', async () => {
    mocks.resolveConnector.mockImplementation(() => {
      throw new Error('boom');
    });

    const result = await install('weather');

    expect(result).toMatchObject({
      content: 'Failed to install plugin: boom',
      error: { message: 'boom', type: 'RuntimeError' },
      state: { error: 'boom', installed: false, pluginId: 'weather', success: false },
      success: false,
    });
  });
});
