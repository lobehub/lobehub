/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorSourceType } from '@/database/schemas';

import ConnectorDetail from './index';

const mocks = vi.hoisted(() => ({
  headerWidth: 1024,
  toolState: {
    connectorTools: {
      createTools: [],
      deleteTools: [],
      readTools: [],
      updateTools: [],
    },
    connectors: [] as Array<{
      id: string;
      identifier: string;
      metadata?: { description?: string };
      mcpConnectionType?: string;
      name: string;
      sourceType: string;
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
    uninstallMCPPlugin: vi.fn(),
    updateToolPermission: vi.fn(),
  },
}));

vi.mock('ahooks', () => ({
  useSize: () => ({ height: 42, width: mocks.headerWidth }),
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

vi.mock('@lobehub/ui', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('antd', () => ({
  App: { useApp: () => ({ message: { error: vi.fn() } }) },
}));

// Stub the base-ui Button to a native button — it needs a MotionProvider the
// app sets up globally but the unit env doesn't.
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    'aria-label': ariaLabel,
    children,
    disabled,
    title,
    onClick,
  }: {
    'aria-label'?: string;
    children?: ReactNode;
    disabled?: boolean;
    title?: string;
    onClick?: () => void;
  }) => (
    <button aria-label={ariaLabel} disabled={disabled} title={title} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  confirmModal: vi.fn(),
}));

vi.mock('@/store/tool', () => ({
  useToolStore<T>(selector: (state: typeof mocks.toolState) => T): T {
    return selector(mocks.toolState);
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
    mocks.headerWidth = 1024;
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
        metadata: { description: 'Workspace notes' },
        name: 'Notion',
        sourceType: ConnectorSourceType.marketplace,
      },
    ];
    mocks.toolState.syncing = false;
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

  it('collapses icon buttons when the header is narrow', () => {
    mocks.headerWidth = 500;
    mocks.toolState.connectors = [
      {
        id: 'connector-1',
        identifier: 'custom-id',
        metadata: { description: 'Workspace notes' },
        mcpConnectionType: 'http',
        name: 'Custom',
        sourceType: ConnectorSourceType.custom,
      },
    ];

    render(<ConnectorDetail connectorId="connector-1" />);

    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset permissions' })).toBeInTheDocument();
    expect(screen.queryByText('Sync')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});
