import type { ItemType } from '@lobehub/ui';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  composioEnabled: false,
  composioServers: [] as Pick<ComposioServer, 'identifier' | 'status'>[],
  lobehubEnabled: false,
  lobehubSkillServers: [] as LobehubSkillServer[],
  mode: 'auto',
  plugins: [] as { identifier: string; mode: string }[],
  skills: [
    { id: 'market-row', identifier: 'excel-analysis', name: 'Excel Analysis', source: 'market' },
    { id: 'user-row', identifier: 'custom-writing', name: 'Custom Writing', source: 'user' },
  ],
  togglePlugin: vi.fn(),
  setPluginMode: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => mocks.agentId }));
vi.mock('../../hooks/useEffectiveModel', () => ({
  useEffectiveModel: () => ({ model: 'model', provider: 'provider' }),
}));
vi.mock('../../hooks/useUpdateAgentConfig', () => ({
  useUpdateAgentConfig: () => ({ updateAgentChatConfig: vi.fn() }),
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
  useAgentStore: (selector: (state: unknown) => unknown) =>
    selector({ setPluginMode: mocks.setPluginMode, togglePlugin: mocks.togglePlugin }),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentConfigById: () => () => ({ plugins: mocks.plugins }),
    getAgentPluginsById: () => () => mocks.checked,
  },
  chatConfigByIdSelectors: {
    getSearchModeById: () => () => 'off',
    getSkillActivateModeById: () => () => mocks.mode,
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
      isConnectorsInit: true,
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
    fixedDisplayMetaList: () => () => [],
    installedBuiltinSkills: () => mocks.builtinSkills,
    // The real metadata inventory mixes tools and skill manifests.
    metaList: () => [
      { identifier: 'builtin-tool', meta: { title: 'Builtin Tool' } },
      ...mocks.builtinSkills,
      ...mocks.skills,
    ],
    metaListIncludingHidden: () => [
      { identifier: 'builtin-tool', meta: { title: 'Builtin Tool' } },
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
vi.mock('@/store/tool/slices/connector', () => ({
  connectorSelectors: { userMcpConnectors: () => [] },
}));

const leafKeys = (items: ItemType[]): string[] =>
  items.flatMap((item) => {
    if (!item || item.type === 'divider') return [];
    if ('children' in item) return leafKeys(item.children ?? []);
    return [String(item.key)];
  });

const toolIds = ['builtin-tool', 'community-mcp', 'custom-mcp'];
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
    mocks.composioEnabled = false;
    mocks.composioServers = [];
    mocks.lobehubEnabled = false;
    mocks.lobehubSkillServers = [];
    mocks.plugins = [];
    mocks.mode = 'auto';
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
      { identifier: 'gmail', mode: 'auto' },
      { identifier: 'vercel', mode: 'auto' },
      { identifier: 'google-drive', mode: 'disabled' },
    ];
    const { result } = renderHook(() => useControls());

    const { autoCount, marketItems } = result.current;
    const autoGroup = marketItems.find((item) => item?.key === 'auto');
    expect(autoGroup?.type).toBe('group');
    if (autoGroup?.type !== 'group') throw new Error('Missing Auto group');
    expect(leafKeys(autoGroup.children ?? []).sort()).toEqual(
      [...toolIds, 'gmail', 'vercel'].sort(),
    );
    expect(autoCount).toBe(toolIds.length + 2);
    const disabledGroup = marketItems.find((item) => item?.key === 'disabled');
    expect(disabledGroup?.type).toBe('group');
    if (disabledGroup?.type !== 'group') throw new Error('Missing Disabled group');
    expect(leafKeys(disabledGroup.children ?? [])).toEqual(
      expect.arrayContaining(['airtable', 'slack']),
    );
    const keys = leafKeys(marketItems);
    for (const identifier of ['google-drive', 'notion', 'twitter'])
      expect(keys).not.toContain(identifier);

    act(() => result.current.marketHeader.props.onChange({ target: { value: 'Google Drive' } }));
    expect(leafKeys(result.current.marketItems)).toEqual([]);
    expect(result.current.autoCount).toBe(toolIds.length + 2);
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
      expect(result.current.pinnedCount).toBe(0);
      expect(result.current.autoCount).toBe(toolIds.length);
      expect(mocks.togglePlugin).not.toHaveBeenCalled();
      expect(mocks.setPluginMode).not.toHaveBeenCalled();
    },
  );

  it('also excludes builtin and user skills from the installed picker in manual mode', () => {
    mocks.mode = 'manual';
    mocks.checked = [...toolIds, ...libraryIds];
    mocks.plugins = mocks.checked.map((identifier) => ({ identifier, mode: 'pinned' }));
    const { result } = renderHook(() => useControls());

    expect(leafKeys(result.current.installedPluginItems)).toEqual(expect.arrayContaining(toolIds));
    for (const id of libraryIds) {
      expect(leafKeys(result.current.marketItems)).not.toContain(id);
      expect(leafKeys(result.current.installedPluginItems)).not.toContain(id);
    }
    expect(result.current.pinnedCount).toBe(toolIds.length);
  });

  it.each(['Excel Analysis', 'lobe-agent-browser', 'lobe-artifacts', 'lobehub'])(
    'does not reveal skills through search for %s',
    (value) => {
      const { result } = renderHook(() => useControls());
      act(() => result.current.marketHeader.props.onChange({ target: { value } }));
      expect(leafKeys(result.current.marketItems)).toEqual([]);
    },
  );
});
