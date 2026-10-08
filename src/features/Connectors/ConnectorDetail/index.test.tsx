/**
 * @vitest-environment happy-dom
 */
import { toast } from '@lobehub/ui/base-ui';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as workspaceHooks from '@/business/client/hooks/useActiveWorkspaceId';
import { ConnectorSourceType } from '@/database/schemas';
import SkillDetail from '@/features/Settings/skill/features/SkillDetail';
import { lambdaClient, toolsClient } from '@/libs/trpc/client';
import { useToolStore } from '@/store/tool';
import { initialState } from '@/store/tool/initialState';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import ConnectorDetail from './index';

const originalState = useToolStore.getState();

const mocks = vi.hoisted(() => ({
  toolState: {
    connectors: [] as ConnectorWithTools[],
    deleteConnector: vi.fn(),
    disconnectConnector: vi.fn(),
    fetchConnectors: vi.fn(),
    resetConnectorPermissions: vi.fn(),
    syncBuiltinTool: vi.fn(),
    syncConnectorTools: vi.fn(),
    syncLobehubSkillTools: vi.fn(),
    syncPluginTools: vi.fn(),
    uninstallBuiltinTool: vi.fn(),
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

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getComposioAppByIdentifier: () => undefined,
  getLobehubSkillProviderById: () => undefined,
}));

// The manage gate pulls in the user store chain — irrelevant to these render
// tests, and it drags heavy module graphs into the unit env.
vi.mock('@/hooks/useResourceManageable', () => ({
  useResourceManageable: () => true,
}));

vi.mock('../CustomConnectorModal', () => ({
  default: () => <div data-testid="custom-connector-modal" />,
}));

vi.mock('@/features/Connectors', async () => ({
  ConnectorDetail: (await import('./index')).default,
  CustomConnectorModal: () => null,
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/features/SkillStore/SkillList/LobeHub/useSkillConnect', () => ({
  useSkillConnect: () => ({ isConnected: true, isConnecting: false }),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: {
      list: { query: vi.fn() },
      syncToolsFromClient: { mutate: vi.fn() },
    },
  },
  toolsClient: { market: { connectListTools: { query: vi.fn() } } },
}));

describe('ConnectorDetail', () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.toolState.connectors = [
      {
        credentials: null,
        id: 'connector-1',
        identifier: 'notion',
        isEnabled: true,
        mcpConnectionType: null,
        mcpServerUrl: null,
        metadata: { description: 'Workspace notes' },
        name: 'Notion',
        sourceType: ConnectorSourceType.marketplace,
        status: 'connected',
        tools: [],
      },
    ];
    useToolStore.setState({
      ...originalState,
      ...initialState,
      ...mocks.toolState,
    });
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

  it('should refresh Linear via the pending-aware OAuth sync action', async () => {
    mocks.toolState.connectors[0].identifier = 'linear';
    render(<ConnectorDetail connectorId="connector-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() =>
      expect(mocks.toolState.syncLobehubSkillTools).toHaveBeenCalledWith(
        mocks.toolState.connectors[0],
      ),
    );
    expect(mocks.toolState.syncPluginTools).not.toHaveBeenCalled();
  });

  it('should disable refresh while syncing and enable it again after completion', () => {
    mocks.toolState.connectors[0].identifier = 'linear';
    useToolStore.setState({ connectorSyncing: { 'connector-1': true } });
    const { rerender } = render(<ConnectorDetail connectorId="connector-1" />);
    const refresh = screen.getByRole('button', { name: 'Refresh' });

    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    fireEvent.click(refresh);
    expect(mocks.toolState.syncLobehubSkillTools).not.toHaveBeenCalled();

    act(() => useToolStore.setState({ connectorSyncing: { 'connector-1': false } }));
    rerender(<ConnectorDetail connectorId="connector-1" middleSlot={<div />} />);
    expect(refresh).toBeEnabled();
    fireEvent.click(refresh);
    expect(mocks.toolState.syncLobehubSkillTools).toHaveBeenCalledTimes(1);
  });

  it('should show feedback when Linear sync fails', async () => {
    const notifyError = vi.spyOn(toast, 'error').mockReturnValue({
      close: vi.fn(),
      id: 'test-toast',
      update: vi.fn(),
    });
    mocks.toolState.connectors[0].identifier = 'linear';
    mocks.toolState.syncLobehubSkillTools.mockRejectedValueOnce(new Error('Unavailable'));
    render(<ConnectorDetail connectorId="connector-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith('Operation failed, please try again'),
    );
    expect(mocks.toolState.syncPluginTools).not.toHaveBeenCalled();
  });

  it.each([
    [ConnectorSourceType.marketplace, 'syncPluginTools', 'notion', 'Refresh'],
    [ConnectorSourceType.builtin, 'syncBuiltinTool', 'notion', 'Refresh'],
    [ConnectorSourceType.custom, 'syncConnectorTools', 'connector-1', 'Sync'],
  ] as const)(
    'should keep the %s refresh route unchanged',
    async (sourceType, action, id, label) => {
      mocks.toolState.connectors[0].sourceType = sourceType;
      render(<ConnectorDetail connectorId="connector-1" />);

      fireEvent.click(screen.getByRole('button', { name: label }));

      await waitFor(() => expect(mocks.toolState[action]).toHaveBeenCalledWith(id));
      expect(mocks.toolState.syncLobehubSkillTools).not.toHaveBeenCalled();
    },
  );
});

describe('Linear refresh with mounted SkillDetail and real tool store', () => {
  const linear: ConnectorWithTools = {
    credentials: null,
    id: '00000000-0000-4000-8000-000000000001',
    identifier: 'linear',
    isEnabled: true,
    mcpConnectionType: null,
    mcpServerUrl: null,
    metadata: null,
    name: 'Linear',
    sourceType: 'marketplace',
    status: 'connected',
    tools: [
      {
        crudType: 'read',
        description: null,
        displayName: null,
        id: 'get-document',
        inputSchema: null,
        permission: 'disabled',
        toolName: 'get_document',
        userConnectorId: '00000000-0000-4000-8000-000000000001',
      },
    ],
  };
  const cachedTools = [{ inputSchema: { type: 'object' }, name: 'get_document' }];
  const discovery = vi.mocked(toolsClient.market.connectListTools.query);
  const persist = vi.mocked(lambdaClient.connector.syncToolsFromClient.mutate);
  const list = vi.mocked(lambdaClient.connector.list.query);

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue(null);
    useToolStore.setState({
      ...originalState,
      ...initialState,
      connectors: [linear],
      lobehubSkillServers: [
        {
          identifier: 'linear',
          isConnected: true,
          name: 'Linear',
          status: LobehubSkillStatus.CONNECTED,
          tools: cachedTools,
        },
      ],
    });
    persist.mockResolvedValue({ connectorId: linear.id, toolCount: 1 });
    list.mockResolvedValue([linear] as any);
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    { label: 'nonempty', tools: [{ inputSchema: { type: 'object' }, name: 'save_document' }] },
    { label: 'empty', tools: [] },
  ])(
    'should persist once and retain the editor after a $label manual refresh',
    async ({ tools }) => {
      render(<SkillDetail identifier="linear" type="lobehub-connector" />);
      const refresh = await screen.findByRole('button', { name: 'Refresh' });
      expect(persist).toHaveBeenCalledTimes(1);
      expect(persist.mock.calls[0][0]).not.toHaveProperty('id');
      expect(list).toHaveBeenCalledTimes(1);

      const pending = Promise.withResolvers<any>();
      discovery.mockResolvedValue({ tools } as any);
      persist.mockReturnValueOnce(pending.promise);

      fireEvent.click(refresh);
      await waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
      expect(refresh).toBeDisabled();
      expect(screen.getByText('get_document')).toBeInTheDocument();
      expect(persist).toHaveBeenLastCalledWith({
        id: linear.id,
        identifier: 'linear',
        name: 'Linear',
        sourceType: 'marketplace',
        tools: tools.map((tool) => ({
          description: undefined,
          inputSchema: tool.inputSchema,
          toolName: tool.name,
        })),
      });
      fireEvent.click(refresh);
      expect(discovery).toHaveBeenCalledTimes(1);

      await act(async () => pending.resolve({ connectorId: linear.id, toolCount: tools.length }));
      await waitFor(() => expect(refresh).toBeEnabled());
      expect(persist).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenCalledTimes(2);
      expect(screen.getByText('get_document')).toBeInTheDocument();
      expect(useToolStore.getState().connectors[0].tools[0].permission).toBe('disabled');
      expect(useToolStore.getState().lobehubSkillServers[0].tools).toEqual(cachedTools);

      // Background discovery still updates the provider cache and bootstraps the base row.
      discovery.mockResolvedValue({ tools: [{ name: 'background_tool' }] } as any);
      await act(async () => useToolStore.getState().refreshLobehubSkillTools('linear'));
      await waitFor(() => expect(persist).toHaveBeenCalledTimes(3));
      expect(persist.mock.calls[2][0]).not.toHaveProperty('id');
      expect(persist.mock.calls[2][0].tools).toEqual([{ toolName: 'background_tool' }]);
      expect(useToolStore.getState().lobehubSkillServers[0].tools).toEqual([
        { name: 'background_tool' },
      ]);
      expect(await screen.findByRole('button', { name: 'Refresh' })).toBeEnabled();
    },
  );
});
