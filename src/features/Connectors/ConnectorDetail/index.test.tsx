/**
 * @vitest-environment happy-dom
 */
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
      authorizedByName?: string;
      id: string;
      identifier: string;
      isEnabled?: boolean;
      metadata?: { description?: string };
      mcpConnectionType?: string;
      name: string;
      sourceType: string;
      status?: string;
    }>,
    deleteConnector: vi.fn(),
    disconnectConnector: vi.fn(),
    fetchConnectors: vi.fn(),
    resetConnectorPermissions: vi.fn(),
    syncBuiltinTool: vi.fn(),
    syncConnectorTools: vi.fn(),
    syncPluginTools: vi.fn(),
    syncing: false,
    uninstallBuiltinTool: vi.fn(),
    uninstalledBuiltinTools: [] as string[],
    uninstallMCPPlugin: vi.fn(),
    updateToolPermission: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string } | string) =>
      typeof options === 'object' ? (options.defaultValue ?? _key) : (options ?? _key),
  }),
}));

vi.mock('@lobechat/const', () => ({
  getComposioAppByIdentifier: () => undefined,
  getLobehubSkillProviderById: () => undefined,
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

  it('keeps authorization and identity in Overview and moves permissions to Tools', () => {
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

    // Overview: connection status, identity and lifecycle actions; no permission matrix.
    expect(screen.getByText('connector.connected')).toBeInTheDocument();
    expect(screen.getByText('Avery')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uninstall' })).toBeInTheDocument();
    expect(screen.queryByTestId('permission-group')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /connector\.tab\.tools/ }));

    // Tools: the permission groups and reset, without the lifecycle actions.
    expect(screen.getAllByTestId('permission-group')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Reset permissions' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Uninstall' })).not.toBeInTheDocument();
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

  it('shows an uninstalled built-in tool as uninstalled, matching the list', () => {
    mocks.toolState.connectors[0] = {
      id: 'connector-1',
      identifier: 'lobe-web-browsing',
      name: 'Web Browsing',
      sourceType: ConnectorSourceType.builtin,
    };
    mocks.toolState.uninstalledBuiltinTools = ['lobe-web-browsing'];

    const { unmount } = render(<ConnectorDetail connectorId="connector-1" />);

    expect(screen.getByText('tools.builtins.uninstalled')).toBeInTheDocument();
    expect(screen.queryByText('connector.enabled')).not.toBeInTheDocument();

    unmount();
    mocks.toolState.uninstalledBuiltinTools = [];
    render(<ConnectorDetail connectorId="connector-1" />);

    expect(screen.getByText('connector.enabled')).toBeInTheDocument();
  });
});
