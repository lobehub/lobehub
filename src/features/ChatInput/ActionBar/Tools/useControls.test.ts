import { getUnavailableBuiltinToolIds } from '@lobechat/builtin-tools';
import { getBuiltinOverrides } from '@lobechat/types';
import type { ItemType } from '@lobehub/ui';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ComposioServer, ComposioServerStatus } from '@/store/tool/slices/composioStore/types';
import {
  type LobehubSkillServer,
  LobehubSkillStatus,
} from '@/store/tool/slices/lobehubSkillStore/types';

import { useControls } from './useControls';

const mocks = vi.hoisted(() => ({
  agentId: 'agent-1',
  navigate: vi.fn(),
  builtinSkills: [
    { identifier: 'lobe-agent-browser', name: 'Agent Browser' },
    { identifier: 'lobe-artifacts', name: 'Artifacts' },
    { identifier: 'lobehub', name: 'LobeHub' },
  ],
  checked: [] as string[],
  connectors: [] as Array<{
    identifier: string;
    isEnabled?: boolean;
    metadata: { mountedByAgentId?: string };
    status?: string;
    sourceType: 'custom';
  }>,
  composioEnabled: false,
  composioServers: [] as Pick<ComposioServer, 'identifier' | 'status'>[],
  lobehubEnabled: false,
  lobehubSkillServers: [] as LobehubSkillServer[],
  chatMode: false,
  uninstalled: [] as string[],
  plugins: [] as { builtinOverride?: true; identifier: string; mode: string }[],
  skills: [
    { id: 'market-row', identifier: 'excel-analysis', name: 'Excel Analysis', source: 'market' },
    { id: 'user-row', identifier: 'custom-writing', name: 'Custom Writing', source: 'user' },
  ],
  updateConfig: vi.fn(),
  togglePlugin: vi.fn(),
  setPluginMode: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => mocks.agentId }));
vi.mock('../../hooks/useEffectiveModel', () => ({
  useEffectiveModel: () => ({ model: 'model', provider: 'provider' }),
}));
vi.mock('../../hooks/useUpdateAgentConfig', () => ({
  useUpdateAgentConfig: () => ({ updateAgentConfig: mocks.updateConfig }),
}));
vi.mock('../Memory/useMemoryEnabled', () => ({ useMemoryEnabled: () => false }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/features/Connectors/CustomConnectorModal/useConnectorConfigure', () => ({
  useConnectorConfigure: () => () => undefined,
}));
vi.mock('@/hooks/useFetchInstalledPlugins', () => ({ useFetchInstalledPlugins: vi.fn() }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/store/agent', () => ({
  useAgentStore: Object.assign((selector: (state: unknown) => unknown) => selector({}), {
    getState: () => ({}),
  }),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentConfigById: () => () => ({ plugins: mocks.plugins }),
    getAgentPluginsById: () => () => mocks.checked,
  },
  chatConfigByIdSelectors: {
    getSearchModeById: () => () => 'off',
    isChatModeById: () => () => mocks.chatMode,
  },
}));
vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: { isModelBuiltinSearchInternal: () => () => false },
  useAiInfraStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    enableComposio: () => mocks.composioEnabled,
    enableLobehubSkill: () => mocks.lobehubEnabled,
  },
  useServerConfigStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: unknown) => unknown) =>
    selector({
      composioServers: mocks.composioServers,
      connectors: mocks.connectors,
      isConnectorsInit: true,
      uninstalledBuiltinTools: mocks.uninstalled,
      lobehubSkillServers: mocks.lobehubSkillServers,
      useFetchAgentSkills: vi.fn(),
      useFetchLobehubSkillConnections: vi.fn(),
      useFetchUninstalledBuiltinTools: vi.fn(),
      useFetchUserComposioConnections: vi.fn(),
    }),
}));
vi.mock('@/store/tool/selectors', () => ({
  agentSkillsSelectors: {
    getMarketAgentSkills: () => mocks.skills.filter((skill) => skill.source === 'market'),
    getUserAgentSkills: () => mocks.skills.filter((skill) => skill.source === 'user'),
  },
  builtinToolSelectors: {
    fixedDisplayMetaList: () => () => [{ identifier: 'lobe-skills', meta: { title: 'Skills' } }],
    installedBuiltinSkills: () => mocks.builtinSkills,
    // The real metadata inventory mixes tools and skill manifests.
    metaList: () => [
      { identifier: 'lobe-calculator', meta: { title: 'Builtin Tool' } },
      ...mocks.builtinSkills,
      ...mocks.skills,
    ],
    metaListIncludingHidden: () => [
      { identifier: 'lobe-calculator', meta: { title: 'Builtin Tool' } },
      ...mocks.builtinSkills,
      ...mocks.skills,
    ],
  },
  composioStoreSelectors: { getServers: () => mocks.composioServers },
  lobehubSkillStoreSelectors: { getServers: () => mocks.lobehubSkillServers },
  pluginSelectors: {
    installedPluginMetaList: () => [
      { identifier: 'community-mcp', title: 'Community MCP', type: 'plugin' },
      { identifier: 'custom-mcp', title: 'Custom MCP', type: 'customPlugin' },
    ],
  },
}));
vi.mock(
  '@/store/tool/slices/connector',
  async () => import('@/store/tool/slices/connector/selectors'),
);

const leafKeys = (items: ItemType[]): string[] =>
  items.flatMap((item) => {
    if (!item || item.type === 'divider') return [];
    if ('children' in item) return leafKeys(item.children ?? []);
    return [String(item.key)];
  });

const toolIds = ['lobe-calculator', 'community-mcp', 'custom-mcp'];
const libraryIds = [
  'excel-analysis',
  'custom-writing',
  'lobe-agent-browser',
  'lobe-artifacts',
  'lobehub',
];

describe('chat input tool picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentId = 'agent-1';
    mocks.checked = [];
    mocks.connectors = [];
    mocks.composioEnabled = false;
    mocks.composioServers = [];
    mocks.lobehubEnabled = false;
    mocks.lobehubSkillServers = [];
    mocks.plugins = [];
    mocks.uninstalled = [];
    mocks.chatMode = false;
  });

  afterEach(cleanup);

  it.each([
    { id: 'gmail', pin: false },
    { id: 'lobe-calculator', pin: false },
  ])('offers the applicable activation actions on the $id row', async ({ id, pin }) => {
    mocks.composioEnabled = true;
    mocks.composioServers = [{ identifier: 'gmail', status: ComposioServerStatus.ACTIVE }];
    mocks.plugins = [{ identifier: 'gmail', mode: 'auto' }];

    const Row = () => {
      const { marketItems } = useControls();
      const row = marketItems.find((item) => item?.key === id);
      if (!row || !('label' in row)) throw new Error(`Missing row ${id}`);
      return createElement(Fragment, null, row.label);
    };
    render(createElement(Row));
    fireEvent.contextMenu(screen.getByRole('button', { name: 'tools.skillActivateMode.title' }));

    expect(await screen.findByRole('button', { name: 'tools.loading.onDemand' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'tools.loading.never' })).toBeTruthy();
    expect(!!screen.queryByRole('button', { name: 'tools.activation.action.pin' })).toBe(pin);
  });

  it('does not list the fixed skill loader as a configurable tool, even with a legacy disable', () => {
    mocks.plugins = [{ identifier: 'lobe-skills', mode: 'disabled' }];
    const { result } = renderHook(() => useControls());
    act(() => result.current.marketHeader.props.onSearchChange('lobe-skills'));
    expect(leafKeys(result.current.marketItems)).not.toContain('lobe-skills');
  });

  it('keeps an uninstalled calculator selectable and re-enables it for just the edited agent', async () => {
    const id = 'lobe-calculator';
    const previous = [{ identifier: id, mode: 'auto' as const }];
    mocks.plugins = previous;
    mocks.uninstalled = [id];
    const { result, rerender } = renderHook(() => useControls());
    const option = () => result.current.toolOptions.find((row) => row.id === id);
    expect(option()?.enabled).toBe(false);

    await act(() => result.current.setPolicy(id, 'auto'));
    const { plugins } = mocks.updateConfig.mock.lastCall![0];
    mocks.plugins = plugins;
    rerender();
    expect(option()?.enabled).toBe(true);
    for (const toolMode of ['agent', 'chat'] as const) {
      expect(
        getUnavailableBuiltinToolIds([id], { toolMode }, [id], getBuiltinOverrides(plugins)),
      ).not.toContain(id);
      expect(
        getUnavailableBuiltinToolIds([id], { toolMode }, [id], getBuiltinOverrides(previous)),
      ).toContain(id);
    }
    await act(() => result.current.setPolicy(id, 'disabled'));
    mocks.plugins = mocks.updateConfig.mock.lastCall![0].plugins;
    rerender();
    expect(option()?.enabled).toBe(false);
  });

  it.each(['lobe-image-generation', 'lobe-video-generation'])(
    're-enables %s as mode auto with builtinOverride in either mode',
    async (id) => {
      mocks.plugins = [{ identifier: id, mode: 'disabled' }];
      const { result } = renderHook(() => useControls());

      mocks.chatMode = false;
      await act(() => result.current.setPolicy(id, 'auto'));
      expect(mocks.updateConfig).toHaveBeenLastCalledWith({
        plugins: [{ builtinOverride: true, identifier: id, mode: 'auto' }],
      });

      mocks.chatMode = true;
      await act(() => result.current.setPolicy(id, 'auto'));
      expect(mocks.updateConfig).toHaveBeenLastCalledWith({
        plugins: [{ builtinOverride: true, identifier: id, mode: 'auto' }],
      });
    },
  );

  it('writes an explicit auto entry when re-enabling a connector in agent mode', async () => {
    mocks.composioEnabled = true;
    mocks.composioServers = [{ identifier: 'gmail', status: ComposioServerStatus.ACTIVE }];
    mocks.plugins = [{ identifier: 'gmail', mode: 'disabled' }];
    const { result } = renderHook(() => useControls());

    await act(() => result.current.setPolicy('gmail', 'auto'));
    expect(mocks.updateConfig).toHaveBeenLastCalledWith({
      plugins: [{ identifier: 'gmail', mode: 'auto' }],
    });
  });

  it('only shows connectors with connection records and keeps rows needing authorization', () => {
    mocks.composioEnabled = true;
    mocks.composioServers = [
      { identifier: 'gmail', status: ComposioServerStatus.ACTIVE },
      { identifier: 'slack', status: ComposioServerStatus.ERROR },
      { identifier: 'airtable', status: ComposioServerStatus.PENDING_AUTH },
    ];
    mocks.lobehubEnabled = true;
    mocks.lobehubSkillServers = [
      {
        identifier: 'notion',
        isConnected: false,
        name: 'Notion',
        status: LobehubSkillStatus.NOT_CONNECTED,
      },
      {
        identifier: 'vercel',
        isConnected: true,
        name: 'Vercel',
        status: LobehubSkillStatus.CONNECTED,
      },
    ];
    mocks.plugins = [
      { identifier: 'slack', mode: 'auto' },
      { identifier: 'google-drive', mode: 'disabled' },
    ];
    const { result } = renderHook(() => useControls());

    const { autoCount, marketItems } = result.current;
    expect(leafKeys(marketItems).sort()).toEqual([...toolIds, 'gmail', 'vercel'].sort());
    expect(autoCount).toBe(toolIds.length + 2);
    act(() => result.current.marketHeader.props.onFilterChange('disabled'));
    expect(leafKeys(result.current.marketItems)).toEqual(
      expect.arrayContaining(['airtable', 'slack']),
    );
    const keys = leafKeys(marketItems);
    for (const identifier of ['google-drive', 'notion', 'twitter'])
      expect(keys).not.toContain(identifier);

    act(() => result.current.marketHeader.props.onSearchChange('lobe-calculator'));
    expect(leafKeys(result.current.marketItems)).toEqual(['lobe-calculator']);
    act(() => result.current.marketHeader.props.onSearchChange(''));
    expect(leafKeys(result.current.marketItems)).toContain('slack');
    act(() => result.current.marketHeader.props.onSearchChange('Google Drive'));
    expect(result.current.marketHeader.props.empty).toBe(true);
    expect(leafKeys(result.current.marketItems)).toEqual([]);
    expect(result.current.autoCount).toBe(toolIds.length + 2);
  });

  it('writes web browsing to the search setting, clearing only its stale plugin override', async () => {
    const other = { identifier: 'my-skill', mode: 'pinned' };
    mocks.plugins = [other, { identifier: 'lobe-web-browsing', mode: 'disabled' }];
    const { result } = renderHook(() => useControls());
    await act(() => result.current.setPolicy('lobe-web-browsing', 'auto'));
    expect(mocks.updateConfig).toHaveBeenCalledExactlyOnceWith({
      chatConfig: { searchMode: 'auto' },
      plugins: [other],
    });
  });

  it('offers only free library MCP connections and those mounted to this agent', () => {
    mocks.connectors = [
      { identifier: 'free', metadata: {}, sourceType: 'custom' },
      { identifier: 'lent-here', metadata: { mountedByAgentId: 'agent-1' }, sourceType: 'custom' },
      {
        identifier: 'lent-elsewhere',
        metadata: { mountedByAgentId: 'agent-2' },
        sourceType: 'custom',
      },
    ];
    const { result } = renderHook(() => useControls());
    const ids = result.current.toolOptions.map((option) => option.id);
    expect(ids).toEqual(expect.arrayContaining(['free', 'lent-here']));
    expect(ids).not.toContain('lent-elsewhere');
  });

  it('counts a newly connected library tool without a plugin entry and leaves the pending tool off', () => {
    mocks.connectors = [
      {
        identifier: 'ready',
        isEnabled: true,
        metadata: {},
        sourceType: 'custom',
        status: 'connected',
      },
      {
        identifier: 'pending',
        isEnabled: true,
        metadata: {},
        sourceType: 'custom',
        status: 'disconnected',
      },
    ];

    const { result } = renderHook(() => useControls());
    const activeIds = result.current.toolOptions.filter((row) => row.enabled).map((row) => row.id);
    expect(activeIds).toContain('ready');
    expect(activeIds).not.toContain('pending');
  });

  it('derives the profile summary from the same unfiltered options as chat', () => {
    const { result } = renderHook(() => useControls());
    const active = leafKeys(result.current.marketItems);
    act(() => result.current.marketHeader.props.onFilterChange('disabled'));
    const disabled = leafKeys(result.current.marketItems);
    expect(disabled).toContain('lobe-web-browsing');
    const options = result.current.toolOptions;
    expect(options.filter((tool) => tool.enabled).map((tool) => tool.id)).toEqual(active);
    expect(options.filter((tool) => !tool.enabled).map((tool) => tool.id)).toEqual(disabled);
    expect(options.find((tool) => tool.id === 'lobe-web-browsing')?.title).toBe(
      'tools.builtins.lobe-web-browsing.title',
    );
    expect(result.current.totalCount).toBe(active.length + disabled.length);
    act(() => result.current.marketHeader.props.onSearchChange('no such tool'));
    expect(
      result.current.toolOptions.filter((tool) => tool.enabled).map((tool) => tool.id),
    ).toEqual(active);
  });

  it('offers only tool management in the footer, without an add-tools action', () => {
    const { result } = renderHook(() => useControls());

    expect(result.current.marketFooter?.type).toBe('button');
    expect(result.current.marketFooter?.props['aria-label']).toBe('tools.picker.management');
  });

  it('closes the menu before navigating to the composer agent tools profile', () => {
    mocks.agentId = 'composer-agent';
    const closeDropdown = vi.fn();
    const { result } = renderHook(() => useControls({ closeDropdown }));

    act(() => result.current.marketFooter?.props.onClick({ stopPropagation: vi.fn() }));

    expect(mocks.navigate).toHaveBeenCalledWith('/agent/composer-agent/tools');
    expect(closeDropdown).toHaveBeenCalledOnce();
    expect(closeDropdown.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.navigate.mock.invocationCallOrder[0],
    );
  });

  it('does not navigate to an invalid profile while the agent is unresolved', () => {
    mocks.agentId = '';
    const closeDropdown = vi.fn();
    const { result } = renderHook(() => useControls({ closeDropdown }));

    expect(result.current.marketFooter?.props.disabled).toBe(true);
    act(() => result.current.marketFooter?.props.onClick({ stopPropagation: vi.fn() }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(closeDropdown).not.toHaveBeenCalled();
  });

  it.each(['pinned', 'auto', 'disabled'])(
    'excludes builtin and user skills in %s mode, including counts',
    (mode) => {
      mocks.plugins = libraryIds.map((identifier) => ({ identifier, mode }));
      mocks.checked = mode === 'pinned' ? libraryIds : [];
      const { result } = renderHook(() => useControls());

      const keys = leafKeys(result.current.marketItems);
      expect(keys).toEqual(expect.arrayContaining(toolIds));
      for (const id of libraryIds) expect(keys).not.toContain(id);
      expect(result.current.marketItems.some((item) => item?.key === 'pinned')).toBe(false);
      expect(result.current.autoCount).toBe(toolIds.length);
      expect(mocks.togglePlugin).not.toHaveBeenCalled();
      expect(mocks.setPluginMode).not.toHaveBeenCalled();
    },
  );

  it.each(['Excel Analysis', 'lobe-agent-browser', 'lobe-artifacts', 'lobehub'])(
    'does not reveal skills through search for %s',
    (value) => {
      const { result } = renderHook(() => useControls());
      act(() => result.current.marketHeader.props.onSearchChange(value));
      expect(leafKeys(result.current.marketItems)).toEqual([]);
    },
  );
});
