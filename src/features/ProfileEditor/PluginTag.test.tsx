/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
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
  marketplaceConnectors: [] as Array<Record<string, unknown>>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) => (opts?.name ? `${key}:${opts.name}` : key),
  }),
}));
vi.mock('@/hooks/useIsDark', () => ({ useIsDark: () => false }));

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const factories: ((original: typeof importOriginal) => unknown)[] = [
    async (importOriginal) => ({
      ...(await importOriginal<object>()),
      createStaticStyles: () => ({}),
      cssVar: new Proxy({}, { get: () => 'var(--x)' }),
    }),
    async (importOriginal) => ({
      ...(await importOriginal<object>()),
      Avatar: ({ title }: { title?: string }) => <span data-testid="author-avatar">{title}</span>,
    }),
    async (importOriginal) => ({
      ...(await importOriginal<object>()),
      Avatar: ({ title }: { title?: string }) => <span data-testid="author-avatar">{title}</span>,
      Tooltip: ({ children, title }: { children: ReactNode; title?: string }) => (
        <div data-testid="author-tooltip" data-title={title}>
          {children}
        </div>
      ),
    }),
  ];
  const merged: Record<string, unknown> = { ...actual };
  for (const factory of factories) {
    const part = (await factory(importOriginal)) as Record<string, unknown>;
    for (const [key, value] of Object.entries(part)) if (value !== actual[key]) merged[key] = value;
  }
  return merged;
});
vi.mock('@lobechat/const', () => ({ resolveConnectorCatalogItem: () => undefined }));
vi.mock('@lobehub/ui/icons', () => ({ McpIcon: () => null }));
vi.mock('@/components/Plugins/PluginAvatar', () => ({ default: () => null }));

// Run selectors against controlled state (the mocked selectors ignore state).
vi.mock('@/store/tool', () => ({
  useToolStore: (sel: (s: unknown) => unknown) => sel({ builtinTools: [] }),
}));
vi.mock('@/store/tool/slices/connector/selectors', () => ({
  connectorSelectors: {
    agentConnectors: () => () => mocks.agentConnectors,
    connectorList: () => mocks.connectorList,
    customConnectors: () => [],
    marketplaceMcpConnectors: () => mocks.marketplaceConnectors,
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
    sel({ useFetchPluginDetail: () => ({ isLoading: false, queryKey: undefined }) }),
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

describe('PluginTag row variant', () => {
  beforeEach(() => {
    mocks.agentConnectors = [];
    mocks.connectorList = [];
    mocks.marketplaceConnectors = [];
  });

  // `isPluginInstalled` counts it, so no remote lookup would fill the gap
  it('resolves a marketplace MCP installed as a connector alone, with its tools', () => {
    mocks.marketplaceConnectors = [
      {
        identifier: 'github-mcp',
        metadata: { avatar: '🐙', description: 'Work with GitHub' },
        name: 'GitHub',
        tools: [
          { description: 'Open an issue', displayName: null, toolName: 'create_issue' },
          { description: null, displayName: null, toolName: 'search' },
        ],
      },
    ];
    const onOpen = vi.fn();
    render(<PluginTag pluginId="github-mcp" variant="row" onOpen={onOpen} />);

    expect(screen.queryByText(/tools\.notInstalled/)).toBeNull();
    expect(screen.getByText('settingAgent.tools.type.plugin')).toBeTruthy();
    expect(screen.getByText('settingAgent.tools.toolCount')).toBeTruthy();
    fireEvent.click(screen.getByText('GitHub'));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Work with GitHub',
        identifier: 'github-mcp',
        tools: [
          { description: 'Open an issue', name: 'create_issue' },
          { description: null, name: 'search' },
        ],
      }),
    );
  });

  it('names the kind of tool and shows whose credentials it runs under', () => {
    mocks.agentConnectors = [
      { authorizedByAvatar: null, authorizedByName: '张三', identifier: 'gmail' },
    ];
    render(<PluginTag showAuthor agentId="agt-1" pluginId="gmail" variant="row" />);

    expect(screen.getByText('settingAgent.tools.type.custom-connector')).toBeTruthy();
    expect(screen.getByTestId('author-avatar')).toHaveTextContent('张三');
  });

  it('names the kind as a skill when the row sits in the skills list', () => {
    mocks.agentConnectors = [
      { authorizedByAvatar: null, authorizedByName: '张三', identifier: 'gmail' },
    ];
    render(<PluginTag isSkill pluginId="gmail" variant="row" />);

    expect(screen.getByText('settingAgent.tools.type.skill')).toBeTruthy();
    expect(screen.queryByText('settingAgent.tools.type.custom-connector')).toBeNull();
  });

  it('shows how many tools an item brings, and opens its details on click', () => {
    mocks.agentConnectors = [
      {
        authorizedByAvatar: null,
        authorizedByName: null,
        identifier: 'gmail',
        name: 'Gmail',
        tools: [
          { description: 'Send a mail', displayName: null, toolName: 'send' },
          { description: null, displayName: 'Read', toolName: 'read' },
        ],
      },
    ];
    const onOpen = vi.fn();
    render(<PluginTag agentId="agt-1" pluginId="gmail" variant="row" onOpen={onOpen} />);

    expect(screen.getByText('settingAgent.tools.toolCount')).toBeTruthy();
    fireEvent.click(screen.getByText('Gmail'));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'gmail',
        tools: [
          { description: 'Send a mail', name: 'send' },
          { description: null, name: 'Read' },
        ],
      }),
    );
  });

  it('switches an item on and off without opening its details', () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    render(
      <PluginTag enabled pluginId="gmail" variant="row" onOpen={onOpen} onToggle={onToggle} />,
    );

    fireEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('labels a row with the given source instead of the stored kind', () => {
    render(<PluginTag isSkill pluginId="gmail" tagLabel="Community" variant="row" />);

    expect(screen.getByText('Community')).toBeTruthy();
  });

  it('offers removal only when the row is removable and editable', () => {
    const { rerender } = render(<PluginTag pluginId="gmail" variant="row" />);
    expect(screen.queryByLabelText('settingAgent.tools.remove')).toBeTruthy();

    rerender(<PluginTag disabled pluginId="gmail" variant="row" />);
    expect(screen.queryByLabelText('settingAgent.tools.remove')).toBeNull();

    rerender(<PluginTag pluginId="gmail" removable={false} variant="row" />);
    expect(screen.queryByLabelText('settingAgent.tools.remove')).toBeNull();
  });
});
