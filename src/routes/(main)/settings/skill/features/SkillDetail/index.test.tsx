/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import SkillDetail from './index';

const mocks = vi.hoisted(() => {
  const toolState = {
    builtinSkills: [],
    checkLobehubSkillStatus: vi.fn(),
    composioServers: [] as Array<{ identifier: string; status: string }>,
    connectors: [] as Array<{ id: string; identifier: string }>,
    createComposioConnection: vi.fn(),
    deleteAgentSkill: vi.fn(),
    fetchConnectors: vi.fn(),
    getLobehubSkillAuthorizeUrl: vi.fn(),
    installBuiltinTool: vi.fn(),
    installedBuiltinIds: [] as string[],
    lobehubSkillServers: [] as Array<{
      identifier: string;
      isConnected: boolean;
      name: string;
      status: string;
      tools?: Array<{
        description?: string;
        inputSchema: Record<string, unknown>;
        name: string;
      }>;
    }>,
    refreshComposioConnectionStatus: vi.fn(),
    removeComposioConnection: vi.fn(),
    revokeLobehubSkill: vi.fn(),
    syncBuiltinTool: vi.fn(),
    syncPluginTools: vi.fn(),
    syncToolsFromClient: vi.fn(),
    uninstallBuiltinTool: vi.fn(),
  };

  function selectToolStore<T>(selector: (state: typeof toolState) => T): T {
    return selector(toolState);
  }

  const useToolStoreWithState = Object.assign(vi.fn(selectToolStore), {
    getState: vi.fn(() => toolState),
  });

  return {
    confirmModal: vi.fn(),
    permissions: {
      create_content: true,
      edit_own_content: true,
    },
    toolState,
    useToolStore: useToolStoreWithState,
    userState: { userId: 'user-id' },
  };
});

vi.mock('@lobechat/const', () => ({
  COMPOSIO_APP_TYPES: [],
  getLobehubSkillProviderById: (identifier: string) =>
    identifier === 'notion'
      ? {
          label: 'Notion',
        }
      : undefined,
}));

vi.mock('@lobehub/ui', () => ({
  Avatar: () => <div data-testid="avatar" />,
  Markdown: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: mocks.confirmModal,
}));

vi.mock('antd', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: (
    creator: (tokens: {
      css: () => string;
      cssVar: Record<string, string>;
    }) => Record<string, string>,
  ) =>
    creator({
      css: () => '',
      cssVar: {
        colorBorderSecondary: 'colorBorderSecondary',
        colorText: 'colorText',
        colorTextSecondary: 'colorTextSecondary',
        colorTextTertiary: 'colorTextTertiary',
      },
    }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; name?: string } | string) => {
      const translations: Record<string, string> = {
        'tools.lobehubSkill.connect': 'Connect',
        'tools.lobehubSkill.disconnect': 'Disconnect',
        'tools.lobehubSkill.disconnectConfirm.desc': `Disconnect ${(options as { name?: string })?.name}?`,
        'tools.lobehubSkill.disconnectConfirm.title': `Disconnect ${(options as { name?: string })?.name}`,
        'tools.noConfigurablePermissions':
          'This skill does not expose configurable tool permissions.',
      };

      if (translations[key]) return translations[key];
      if (typeof options === 'object' && options?.defaultValue) return options.defaultValue;

      return key;
    },
  }),
}));

vi.mock('@/features/AgentSkillDetail', () => ({
  default: () => <div data-testid="agent-skill-detail" />,
}));

vi.mock('@/features/Connectors', () => ({
  ConnectorDetail: ({
    connectorId,
    lifecycleActions,
  }: {
    connectorId: string;
    lifecycleActions?: ReactNode;
  }) => (
    <div data-testid="connector-detail">
      <span>{connectorId}</span>
      {lifecycleActions}
    </div>
  ),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content' | 'edit_own_content') => ({
    allowed: mocks.permissions[action],
    reason: '',
  }),
}));

vi.mock('@/store/tool', () => ({
  useToolStore: mocks.useToolStore,
}));

vi.mock('@/store/tool/selectors', () => ({
  builtinToolSelectors: {
    isBuiltinToolInstalled:
      (identifier: string) =>
      (state: typeof mocks.toolState): boolean =>
        state.installedBuiltinIds.includes(identifier),
  },
  composioStoreSelectors: {
    getServerByIdentifier:
      (identifier: string) =>
      (
        state: typeof mocks.toolState,
      ): (typeof mocks.toolState.composioServers)[number] | undefined =>
        state.composioServers.find((server) => server.identifier === identifier),
  },
  lobehubSkillStoreSelectors: {
    getServerByIdentifier:
      (identifier: string) =>
      (
        state: typeof mocks.toolState,
      ): (typeof mocks.toolState.lobehubSkillServers)[number] | undefined =>
        state.lobehubSkillServers.find((server) => server.identifier === identifier),
  },
}));

vi.mock('@/store/tool/slices/connector', () => ({
  connectorSelectors: {
    connectorByIdentifier:
      (identifier: string) =>
      (state: typeof mocks.toolState): (typeof mocks.toolState.connectors)[number] | undefined =>
        state.connectors.find((connector) => connector.identifier === identifier),
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore<T>(selector: (state: typeof mocks.userState) => T): T {
    return selector(mocks.userState);
  },
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    userId: (state: typeof mocks.userState) => state.userId,
  },
}));

const connectedNotionServer = () => ({
  identifier: 'notion',
  isConnected: true,
  name: 'Notion',
  status: LobehubSkillStatus.CONNECTED,
});

describe('SkillDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.permissions.create_content = true;
    mocks.permissions.edit_own_content = true;
    mocks.toolState.composioServers = [];
    mocks.toolState.connectors = [];
    mocks.toolState.installedBuiltinIds = [];
    mocks.toolState.lobehubSkillServers = [];
  });

  it('shows a disconnect action for a connected LobeHub connector without configurable tools', async () => {
    mocks.toolState.lobehubSkillServers = [connectedNotionServer()];

    render(<SkillDetail identifier="notion" type="lobehub-connector" />);

    expect(
      await screen.findByText('This skill does not expose configurable tool permissions.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Notion')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
    expect(mocks.toolState.syncToolsFromClient).not.toHaveBeenCalled();
  });

  it('syncs LobeHub tools and passes the disconnect action into connector permissions detail', async () => {
    mocks.toolState.connectors = [{ id: 'connector-1', identifier: 'notion' }];
    mocks.toolState.lobehubSkillServers = [
      {
        ...connectedNotionServer(),
        tools: [
          {
            description: 'Search pages',
            inputSchema: { type: 'object' },
            name: 'search',
          },
        ],
      },
    ];

    render(<SkillDetail identifier="notion" type="lobehub-connector" />);

    expect(await screen.findByTestId('connector-detail')).toHaveTextContent('connector-1');
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.toolState.syncToolsFromClient).toHaveBeenCalledWith({
        identifier: 'notion',
        name: 'Notion',
        sourceType: 'marketplace',
        tools: [
          {
            description: 'Search pages',
            inputSchema: { type: 'object' },
            toolName: 'search',
          },
        ],
      }),
    );
  });

  it('only leaves connector permissions detail after disconnect actually succeeds', async () => {
    const user = userEvent.setup();
    mocks.toolState.connectors = [{ id: 'connector-1', identifier: 'notion' }];
    mocks.toolState.lobehubSkillServers = [
      {
        ...connectedNotionServer(),
        tools: [
          {
            inputSchema: { type: 'object' },
            name: 'search',
          },
        ],
      },
    ];
    mocks.confirmModal.mockImplementation(({ onOk }: { onOk?: () => Promise<void> }) => {
      void onOk?.();
    });
    mocks.toolState.revokeLobehubSkill.mockResolvedValue(undefined);

    render(<SkillDetail identifier="notion" type="lobehub-connector" />);

    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));

    expect(mocks.confirmModal).toHaveBeenCalled();
    expect(await screen.findByTestId('connector-detail')).toBeInTheDocument();
    expect(
      screen.queryByText('This skill does not expose configurable tool permissions.'),
    ).not.toBeInTheDocument();
  });

  it('returns to the no-permissions state after a successful disconnect', async () => {
    const user = userEvent.setup();
    const server = {
      ...connectedNotionServer(),
      tools: [
        {
          inputSchema: { type: 'object' },
          name: 'search',
        },
      ],
    };
    mocks.toolState.connectors = [{ id: 'connector-1', identifier: 'notion' }];
    mocks.toolState.lobehubSkillServers = [server];
    mocks.confirmModal.mockImplementation(({ onOk }: { onOk?: () => Promise<void> }) => {
      void onOk?.();
    });
    mocks.toolState.revokeLobehubSkill.mockImplementation(async () => {
      server.isConnected = false;
      server.status = LobehubSkillStatus.NOT_CONNECTED;
    });

    render(<SkillDetail identifier="notion" type="lobehub-connector" />);

    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));

    await waitFor(() =>
      expect(
        screen.getByText('This skill does not expose configurable tool permissions.'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });
});
