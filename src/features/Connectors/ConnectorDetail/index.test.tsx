/**
 * @vitest-environment happy-dom
 */
import type * as LobeConst from '@lobechat/const';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorSourceType } from '@/database/schemas';

import ConnectorDetail from './index';

const mocks = vi.hoisted(() => ({
  toolState: {
    connectorTools: {
      createTools: [],
      deleteTools: [],
      readTools: [],
      updateTools: [],
    },
    connectors: [] as Array<{
      authKind?: string;
      authorizedByName?: string;
      id: string;
      links?: Array<{ id: string; name: string }>;
      identifier: string;
      isEnabled?: boolean;
      metadata?: { description?: string };
      mcpConnectionType?: string;
      mcpServerUrl?: string;
      name: string;
      sourceType: string;
      status?: string;
    }>,
    deleteConnector: vi.fn(),
    disconnectConnector: vi.fn(),
    fetchConnectors: vi.fn(),
    installBuiltinTool: vi.fn(),
    resetConnectorPermissions: vi.fn(),
    syncBuiltinTool: vi.fn(),
    syncConnectorTools: vi.fn(),
    syncPluginTools: vi.fn(),
    syncing: false,
    uninstallBuiltinTool: vi.fn(),
    uninstalledBuiltinTools: [] as string[],
    uninstallMCPPlugin: vi.fn(),
    useFetchUninstalledBuiltinTools: vi.fn(),
    updateToolPermission: vi.fn(),
  },
  manageable: {
    canManage: true,
    canManageCredentials: true,
    isPending: false,
    restrictedByPolicy: false,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string } | string) =>
      typeof options === 'object' ? (options.defaultValue ?? _key) : (options ?? _key),
  }),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  hasCallableMcpEndpoint: (await importOriginal<typeof LobeConst>()).hasCallableMcpEndpoint,
  getComposioAppByIdentifier: () => undefined,
  getLobehubSkillProviderById: () => undefined,
}));

vi.mock('@/hooks/useConnectorManagePolicy', () => ({
  useConnectorManageable: () => mocks.manageable,
}));

// The manage gate pulls in the user store chain — irrelevant to these render
// tests, and it drags heavy module graphs into the unit env.
vi.mock('@/hooks/useResourceManageable', () => ({
  useResourceManageable: () => true,
}));

vi.mock('@/store/tool', () => ({
  useToolStore<T>(selector: (state: typeof mocks.toolState) => T): T {
    return selector(mocks.toolState);
  },
}));

vi.mock('@/store/tool/selectors', () => ({
  builtinToolSelectors: {
    isBuiltinToolInstalled: (identifier: string) => (state: typeof mocks.toolState) =>
      !state.uninstalledBuiltinTools.includes(identifier),
  },
}));

vi.mock('@/store/tool/slices/connector', () => ({
  connectorSelectors: {
    connectorById:
      (connectorId: string) =>
      (state: typeof mocks.toolState): (typeof mocks.toolState.connectors)[number] | undefined =>
        state.connectors.find((connector) => connector.id === connectorId),
    connectorToolsGrouped: () => (state: typeof mocks.toolState) => state.connectorTools,
    isSyncing: () => (state: typeof mocks.toolState) => state.syncing,
  },
}));

vi.mock('../CustomConnectorModal', () => ({
  default: () => <div data-testid="custom-connector-modal" />,
}));

vi.mock('./ConnectorAccounts', () => ({
  default: ({ connector }: { connector: { links?: unknown[] } }) => (
    <div data-testid="connector-accounts">{connector.links?.length ?? 0}</div>
  ),
}));

vi.mock('./ToolPermissionGroup', () => ({
  default: ({ label }: { label: string }) => <div data-testid="permission-group">{label}</div>,
}));

describe('ConnectorDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.toolState.connectorTools = {
      createTools: [],
      deleteTools: [],
      readTools: [],
      updateTools: [],
    };
    mocks.toolState.connectors = [
      {
        id: 'connector-1',
        identifier: 'notion',
        isEnabled: true,
        metadata: { description: 'Workspace notes' },
        name: 'Notion',
        sourceType: ConnectorSourceType.marketplace,
      },
    ];
    mocks.toolState.syncing = false;
    mocks.toolState.uninstalledBuiltinTools = [];
    mocks.manageable.canManageCredentials = true;
  });

  describe('Refresh', () => {
    const refresh = () => fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    it("re-reads a legacy plugin's projected tools from the plugin", () => {
      render(<ConnectorDetail connectorId="connector-1" />);
      refresh();

      expect(mocks.toolState.syncPluginTools).toHaveBeenCalledWith('notion');
      expect(mocks.toolState.syncConnectorTools).not.toHaveBeenCalled();
    });

    // A fresh marketplace install has no legacy plugin row to bootstrap from
    it.each([
      { mcpConnectionType: 'http', mcpServerUrl: 'https://mcp.notion.com/mcp' },
      { mcpConnectionType: 'stdio' },
      { mcpConnectionType: 'cloud' },
    ])('syncs a connector-path install from its own server: %o', (endpoint) => {
      mocks.toolState.connectors[0] = { ...mocks.toolState.connectors[0], ...endpoint };

      render(<ConnectorDetail connectorId="connector-1" />);
      refresh();

      expect(mocks.toolState.syncConnectorTools).toHaveBeenCalledWith('connector-1');
      expect(mocks.toolState.syncPluginTools).not.toHaveBeenCalled();
    });

    it('needs the credentials permission only for a sync that connects to the server', () => {
      mocks.manageable.canManageCredentials = false;
      mocks.toolState.connectors[0] = {
        ...mocks.toolState.connectors[0],
        mcpConnectionType: 'stdio',
      };
      const { unmount } = render(<ConnectorDetail connectorId="connector-1" />);
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
      unmount();

      // A cloud server's tools come from the market manifest
      mocks.toolState.connectors[0] = {
        ...mocks.toolState.connectors[0],
        mcpConnectionType: 'cloud',
      };
      render(<ConnectorDetail connectorId="connector-1" />);
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    });
  });

  // A protocol-link stdio MCP is a custom connector now, no longer a custom
  // plugin whose command Settings could edit
  it.each([
    { mcpConnectionType: 'http', mcpServerUrl: 'https://mcp.example.com' },
    { mcpConnectionType: 'stdio' },
  ])('offers Edit for a custom connector: %o', (endpoint) => {
    mocks.toolState.connectors[0] = {
      ...mocks.toolState.connectors[0],
      ...endpoint,
      sourceType: ConnectorSourceType.custom,
    };

    render(<ConnectorDetail connectorId="connector-1" />);

    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
    expect(screen.getByTestId('custom-connector-modal')).toBeInTheDocument();
  });

  it('offers no Edit for a marketplace connector', () => {
    mocks.toolState.connectors[0] = {
      ...mocks.toolState.connectors[0],
      mcpConnectionType: 'stdio',
    };

    render(<ConnectorDetail connectorId="connector-1" />);

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('uses lifecycle actions instead of the generic marketplace uninstall action', () => {
    render(
      <ConnectorDetail
        connectorId="connector-1"
        lifecycleActions={<button>Disconnect Notion</button>}
      />,
    );

    expect(screen.getByText('Notion')).toBeInTheDocument();
    expect(screen.getByText('Workspace notes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect Notion' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Uninstall' })).not.toBeInTheDocument();
  });

  it('falls back to the marketplace uninstall action when no lifecycle override is provided', () => {
    render(<ConnectorDetail connectorId="connector-1" />);

    expect(screen.getByRole('button', { name: 'Uninstall' })).toBeInTheDocument();
  });

  it('shows authorization, identity and tool permissions on one page', () => {
    mocks.toolState.connectors[0] = {
      ...mocks.toolState.connectors[0],
      authorizedByName: 'Avery',
      status: 'connected',
    };
    mocks.toolState.connectorTools = {
      ...mocks.toolState.connectorTools,
      readTools: [{ id: 'tool-1' }] as never[],
    };

    render(<ConnectorDetail connectorId="connector-1" />);

    // One page: status and identity, the lifecycle actions in the header, then
    // the Tools section with its permission groups and reset.
    expect(screen.getByText('connector.connected')).toBeInTheDocument();
    expect(screen.getByText('Avery')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uninstall' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByText('connectorMarket.detail.tools')).toBeInTheDocument();
    expect(screen.getAllByTestId('permission-group')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Reset permissions' })).toBeInTheDocument();
  });

  it('reports an authorization error instead of "not connected"', () => {
    mocks.toolState.connectors[0] = { ...mocks.toolState.connectors[0], status: 'error' };

    render(<ConnectorDetail connectorId="connector-1" />);

    expect(screen.getByText('connector.authError')).toBeInTheDocument();
    expect(screen.queryByText('connector.notConnected')).not.toBeInTheDocument();
  });

  it('labels a marketplace plugin without an OAuth provider as a community tool', () => {
    render(<ConnectorDetail connectorId="connector-1" />);

    expect(screen.getByText('connector.kind.community')).toBeInTheDocument();
    expect(screen.queryByText('connector.kind.oauth')).not.toBeInTheDocument();
  });

  it('shows a disconnected connector as not connected even though its status stays connected', () => {
    mocks.toolState.connectors[0] = {
      ...mocks.toolState.connectors[0],
      isEnabled: false,
      status: 'connected',
    };

    render(<ConnectorDetail connectorId="connector-1" />);

    expect(screen.getByText('connector.notConnected')).toBeInTheDocument();
    expect(screen.queryByText('connector.connected')).not.toBeInTheDocument();
  });

  it('shows a disconnected connector as not connected even after an authorization error', () => {
    mocks.toolState.connectors[0] = {
      ...mocks.toolState.connectors[0],
      isEnabled: false,
      status: 'error',
    };

    render(<ConnectorDetail connectorId="connector-1" />);

    expect(screen.getByText('connector.notConnected')).toBeInTheDocument();
    expect(screen.queryByText('connector.authError')).not.toBeInTheDocument();
  });

  it.each([true, false])(
    'omits library install actions for a bundled tool (previously installed: %s)',
    (installed) => {
      mocks.toolState.connectors[0] = {
        authorizedByName: 'Avery',
        id: 'connector-1',
        identifier: 'lobe-calculator',
        name: 'Calculator',
        sourceType: ConnectorSourceType.builtin,
      };
      mocks.toolState.uninstalledBuiltinTools = installed ? [] : ['lobe-calculator'];
      render(<ConnectorDetail connectorId="connector-1" />);
      expect(screen.queryByRole('button', { name: 'Uninstall' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'connectorMarket.action.install' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('connector.overview.status')).not.toBeInTheDocument();
      expect(screen.queryByText('connector.overview.authorizedBy')).not.toBeInTheDocument();
    },
  );

  it('shows accounts only for an OAuth connector, each naming its own authorizer', () => {
    mocks.toolState.connectors[0] = {
      ...mocks.toolState.connectors[0],
      authorizedByName: 'Avery',
      sourceType: ConnectorSourceType.custom,
      status: 'connected',
    };

    const { unmount } = render(<ConnectorDetail connectorId="connector-1" />);
    // A static credential has no accounts; its one authorizer stays on the connector.
    expect(screen.queryByTestId('connector-accounts')).not.toBeInTheDocument();
    expect(screen.getByText('Avery')).toBeInTheDocument();
    unmount();

    // Before any account is connected nobody has authorized it yet either.
    mocks.toolState.connectors[0] = { ...mocks.toolState.connectors[0], authKind: 'oauth2' };
    const { unmount: unmountEmpty } = render(<ConnectorDetail connectorId="connector-1" />);
    expect(screen.getByTestId('connector-accounts')).toHaveTextContent('0');
    expect(screen.queryByText('Avery')).not.toBeInTheDocument();
    unmountEmpty();

    mocks.toolState.connectors[0] = {
      ...mocks.toolState.connectors[0],
      links: [
        { id: 'lnk_1', name: 'work@acme.com' },
        { id: 'lnk_2', name: 'Personal' },
      ],
    };
    render(<ConnectorDetail connectorId="connector-1" />);

    expect(screen.getByTestId('connector-accounts')).toHaveTextContent('2');
    expect(screen.queryByText('connector.overview.authorizedBy')).not.toBeInTheDocument();
    expect(screen.queryByText('Avery')).not.toBeInTheDocument();
  });
});
