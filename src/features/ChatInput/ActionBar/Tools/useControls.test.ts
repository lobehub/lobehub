/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement, Fragment } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useControls } from './useControls';

const mocks = vi.hoisted(() => ({
  dismissPolicyMenu: vi.fn(),
  setPluginMode: vi.fn(),
}));

vi.mock('@lobechat/const', () => ({
  COMPOSIO_APP_TYPES: [],
  LOBEHUB_SKILL_PROVIDERS: [],
  RECOMMENDED_SKILLS: [],
  RecommendedSkillType: { Composio: 'composio', Lobehub: 'lobehub' },
}));

vi.mock('@lobechat/types', () => ({ getDisabledPluginIds: () => [] }));

vi.mock('@lobehub/ui', () => ({
  Avatar: () => createElement('span'),
  Icon: () => createElement('span', { 'data-testid': 'policy-icon' }),
  Popover: ({ children, content }: { children: ReactNode; content: ReactNode }) =>
    createElement('div', { onPointerDown: mocks.dismissPolicyMenu }, children, content),
  SearchBar: () => null,
  stopPropagation: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  Tag: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
  Tooltip: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: vi.fn(),
  Switch: () => null,
}));

vi.mock('@lobehub/ui/icons', () => ({ McpIcon: vi.fn(), SkillsIcon: vi.fn() }));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_, key) => String(key) }),
  cssVar: new Proxy({}, { get: (_, key) => String(key) }),
  cx: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/Connectors/CustomConnectorModal/imperative', () => ({
  openConnectorEditDrawer: vi.fn(),
}));
vi.mock('@/features/PluginDevModal/imperative', () => ({ openPluginEditDrawer: vi.fn() }));
vi.mock('@/features/SkillStore', () => ({ createSkillStoreModal: vi.fn() }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/hooks/useCheckPluginsIsInstalled', () => ({ useCheckPluginsIsInstalled: vi.fn() }));
vi.mock('@/hooks/useFetchInstalledPlugins', () => ({ useFetchInstalledPlugins: vi.fn() }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));

const agentState = {
  checked: [],
  setPluginMode: mocks.setPluginMode,
  togglePlugin: vi.fn(),
};

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof agentState) => unknown) => selector(agentState),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentConfigById: () => () => ({ plugins: [] }),
    getAgentPluginsById: () => (state: typeof agentState) => state.checked,
  },
  chatConfigByIdSelectors: { getSkillActivateModeById: () => () => 'manual' },
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    enableComposio: () => false,
    enableLobehubSkill: () => false,
  },
  useServerConfigStore: (selector: (state: Record<string, never>) => unknown) => selector({}),
}));

const toolState = {
  builtinList: [{ identifier: 'test-skill', meta: { title: 'Test skill' } }],
  deleteAgentSkill: vi.fn(),
  deleteConnector: vi.fn(),
  fetchConnectors: vi.fn(),
  isConnectorsInit: true,
  removeComposioConnection: vi.fn(),
  uninstallBuiltinTool: vi.fn(),
  uninstallCustomPlugin: vi.fn(),
  useFetchAgentSkills: vi.fn(),
  useFetchLobehubSkillConnections: vi.fn(),
  useFetchUninstalledBuiltinTools: vi.fn(),
  useFetchUserComposioConnections: vi.fn(),
};

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: typeof toolState) => unknown) => selector(toolState),
}));
vi.mock('@/store/tool/selectors', () => ({
  agentSkillsSelectors: {
    getMarketAgentSkills: () => [],
    getUserAgentSkills: () => [],
  },
  builtinToolSelectors: {
    fixedDisplayMetaList: () => () => [],
    installedBuiltinSkills: () => [],
    metaList: (state: typeof toolState) => state.builtinList,
    metaListIncludingHidden: (state: typeof toolState) => state.builtinList,
  },
  composioStoreSelectors: { getServers: () => [] },
  lobehubSkillStoreSelectors: { getServers: () => [] },
  pluginSelectors: { installedPluginMetaList: () => [] },
}));
vi.mock('@/store/tool/slices/composioStore', () => ({
  ComposioServerStatus: { ACTIVE: 'active' },
}));
vi.mock('@/store/tool/slices/connector', () => ({
  connectorSelectors: { customConnectors: () => [] },
}));
vi.mock('@/store/tool/slices/lobehubSkillStore/types', () => ({
  LobehubSkillStatus: { CONNECTED: 'connected' },
}));

vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => 'agent-1' }));
vi.mock('../../hooks/useUpdateAgentConfig', () => ({
  useUpdateAgentConfig: () => ({ updateAgentChatConfig: vi.fn() }),
}));

vi.mock('./ComposioServerItem', () => ({ default: () => null }));
vi.mock('./ComposioSkillIcon', () => ({ default: () => null }));
vi.mock('./LobehubSkillIcon', () => ({ default: () => null }));
vi.mock('./LobehubSkillServerItem', () => ({ default: () => null }));
vi.mock('./MarketAgentSkillPopoverContent', () => ({ default: () => null }));
vi.mock('./MarketSkillIcon', () => ({ default: () => null }));
vi.mock('./ToolItem', () => ({ default: () => null }));
vi.mock('./ToolItemDetailPopover', () => ({ default: () => null }));

describe('useControls skill policy menu', () => {
  beforeEach(() => {
    mocks.dismissPolicyMenu.mockClear();
    mocks.setPluginMode.mockReset().mockResolvedValue(undefined);
  });

  it.each([
    ['row', (button: HTMLButtonElement) => button],
    ['text', () => screen.getByText('tools.activation.action.disable')],
    ['icon', (button: HTMLButtonElement) => button.querySelector('[data-testid="policy-icon"]')!],
  ])('applies the policy when clicking the %s', async (_, getTarget) => {
    const { result } = renderHook(() => useControls());
    const autoGroup = result.current.marketItems.find((item) => item?.key === 'auto');
    const skillItem = autoGroup && 'children' in autoGroup ? autoGroup.children?.[0] : undefined;

    render(
      createElement(Fragment, null, skillItem && 'label' in skillItem ? skillItem.label : null),
    );

    const disableButton = screen.getByRole('button', {
      name: 'tools.activation.action.disable',
    });
    const target = getTarget(disableButton);

    fireEvent.pointerDown(target);
    fireEvent.click(target);

    expect(mocks.dismissPolicyMenu).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mocks.setPluginMode).toHaveBeenCalledWith('test-skill', 'disabled');
    });
  });
});
