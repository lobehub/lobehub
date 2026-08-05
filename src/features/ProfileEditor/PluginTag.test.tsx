/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PluginTag from './PluginTag';

// Provenance display: when `showAuthor` is set, the chip must attribute the tool
// to the member who authorized the connector — resolving the agent-scoped row
// first, then the base/workspace row. With `showAuthor` off it must render no
// author avatar at all (personal mode / group member profile).

const mocks = vi.hoisted(() => ({
  agentConnectors: [] as Array<{
    authorizedByAvatar?: string | null;
    authorizedByName?: string | null;
    identifier: string;
  }>,
  connectorList: [] as Array<{
    authorizedByAvatar?: string | null;
    authorizedByName?: string | null;
    identifier: string;
  }>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) => (opts?.name ? `${key}:${opts.name}` : key),
  }),
}));
vi.mock('@/hooks/useIsDark', () => ({ useIsDark: () => false }));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({}),
  cssVar: new Proxy({}, { get: () => 'var(--x)' }),
}));
vi.mock('@lobehub/const', () => ({ COMPOSIO_APP_TYPES: [], LOBEHUB_SKILL_PROVIDERS: [] }));
vi.mock('@lobehub/ui/icons', () => ({ McpIcon: () => null }));
vi.mock('@/components/Plugins/PluginAvatar', () => ({ default: () => null }));
vi.mock('@lobehub/ui', () => ({
  Avatar: ({ title }: { title?: string }) => <span data-testid="author-avatar">{title}</span>,
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Icon: () => null,
  Tag: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children, title }: { children: ReactNode; title?: string }) => (
    <div data-testid="author-tooltip" data-title={title}>
      {children}
    </div>
  ),
}));

// Run selectors against controlled state (the mocked selectors ignore state).
vi.mock('@/store/tool', () => ({
  useToolStore: (sel: (s: unknown) => unknown) => sel({}),
}));
vi.mock('@/store/tool/slices/connector/selectors', () => ({
  connectorSelectors: {
    agentConnectors: () => () => mocks.agentConnectors,
    connectorList: () => mocks.connectorList,
    customConnectors: () => [],
  },
}));
vi.mock('@/store/tool/selectors', () => ({
  builtinToolSelectors: { allMetaList: () => [], metaList: () => [] },
  composioStoreSelectors: { getServers: () => [] },
  lobehubSkillStoreSelectors: { getServers: () => [] },
  pluginSelectors: { installedPluginMetaList: () => [], isPluginInstalled: () => () => false },
}));
vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: { enableComposio: () => false, enableLobehubSkill: () => false },
  useServerConfigStore: (sel: (s: unknown) => unknown) => sel({}),
}));
vi.mock('@/store/discover', () => ({
  useDiscoverStore: (sel: (s: unknown) => unknown) =>
    sel({ usePluginDetail: () => ({ data: undefined, isLoading: false }) }),
}));

describe('PluginTag author attribution', () => {
  beforeEach(() => {
    mocks.agentConnectors = [];
    mocks.connectorList = [];
  });

  it('shows the authorizing member on an agent-scoped connector when showAuthor is set', () => {
    mocks.agentConnectors = [
      { authorizedByAvatar: null, authorizedByName: '张三', identifier: 'gmail' },
    ];
    render(<PluginTag showAuthor agentId="agt-1" pluginId="gmail" />);

    const tooltip = screen.getByTestId('author-tooltip');
    expect(tooltip.getAttribute('data-title')).toBe('settingAgent.agentTools.authorizedBy:张三');
    expect(screen.getByTestId('author-avatar')).toHaveTextContent('张三');
  });

  it('prefers the agent-scoped row over the base/workspace row', () => {
    mocks.connectorList = [{ authorizedByName: 'Base Owner', identifier: 'gmail' }];
    mocks.agentConnectors = [{ authorizedByName: '张三', identifier: 'gmail' }];
    render(<PluginTag showAuthor agentId="agt-1" pluginId="gmail" />);

    expect(screen.getByTestId('author-avatar')).toHaveTextContent('张三');
  });

  it('resolves from the base/workspace row when no agent id is given', () => {
    mocks.connectorList = [{ authorizedByName: 'Li Si', identifier: 'gmail' }];
    render(<PluginTag showAuthor pluginId="gmail" />);

    expect(screen.getByTestId('author-avatar')).toHaveTextContent('Li Si');
  });

  it('renders no author avatar when showAuthor is off', () => {
    mocks.agentConnectors = [{ authorizedByName: '张三', identifier: 'gmail' }];
    render(<PluginTag agentId="agt-1" pluginId="gmail" />);

    expect(screen.queryByTestId('author-avatar')).toBeNull();
  });

  it('renders no author avatar when the connector has no recorded authorizer', () => {
    mocks.agentConnectors = [{ authorizedByName: null, identifier: 'gmail' }];
    render(<PluginTag showAuthor agentId="agt-1" pluginId="gmail" />);

    expect(screen.queryByTestId('author-avatar')).toBeNull();
  });
});
