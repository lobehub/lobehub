/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useItemDetailStore } from '@/features/ProfileEditor/itemDetailStore';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

import { ownConnectionSettingsPath, useOwnConnection } from './useOwnConnection';

const AGENT = 'agt_1';

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  chatConfig: {} as { toolMode?: 'custom' },
  connectors: [] as ConnectorWithTools[],
  fetchConnectors: vi.fn(),
  confirm: vi.fn(),
  copyConnectorToAgent: vi.fn(),
  detachConnectorFromAgent: vi.fn(),
  navigate: vi.fn(),
  openAgentStore: vi.fn(),
  plugins: [] as unknown[],
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  updateAgentConfigById: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // Confirming is the user's part; the test answers yes.
  confirmModal: (options: { onOk: () => Promise<void> }) => {
    mocks.confirm(options);
    return options.onOk();
  },
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));
vi.mock('@/features/AgentSkillStore', () => ({
  createAgentSkillStoreModal: mocks.openAgentStore,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/store/agent', () => {
  const state = () => ({ updateAgentConfigById: mocks.updateAgentConfigById });
  return {
    useAgentStore: Object.assign((selector: (s: unknown) => unknown) => selector(state()), {
      getState: state,
    }),
  };
});
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    getAgentConfigById: () => () => ({ chatConfig: mocks.chatConfig, plugins: mocks.plugins }),
  },
}));
vi.mock('@/store/tool', () => {
  const state = () => ({
    connectors: mocks.connectors,
    copyConnectorToAgent: mocks.copyConnectorToAgent,
    detachConnectorFromAgent: mocks.detachConnectorFromAgent,
    fetchConnectors: mocks.fetchConnectors,
  });
  return {
    useToolStore: Object.assign((selector: (s: unknown) => unknown) => selector(state()), {
      getState: state,
    }),
  };
});

const connector = (overrides: Partial<ConnectorWithTools> = {}): ConnectorWithTools => ({
  agentId: AGENT,
  credentials: null,
  id: 'row-own',
  identifier: 'notion',
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: 'https://example.com/mcp',
  metadata: null,
  name: 'Notion',
  sourceType: 'custom',
  status: 'connected',
  tools: [],
  ...overrides,
});

const setup = () => renderHook(() => useOwnConnection(AGENT)).result.current;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.chatConfig = {};
  mocks.connectors = [connector({ agentId: null, id: 'row-lib' })];
  mocks.fetchConnectors.mockResolvedValue(undefined);
  mocks.plugins = [{ identifier: 'notion', mode: 'auto' }];
  mocks.copyConnectorToAgent.mockResolvedValue('row-own');
  mocks.detachConnectorFromAgent.mockImplementation(async () => {
    mocks.calls.push('detach');
  });
  mocks.updateAgentConfigById.mockImplementation(async () => {
    mocks.calls.push('update');
  });
});

describe('useOwnConnection', () => {
  it('gives the agent its own connection by copying the library one', async () => {
    const library = connector({ agentId: null, id: 'row-lib' });

    await setup().create(library);

    expect(mocks.copyConnectorToAgent).toHaveBeenCalledWith('row-lib', AGENT);
    expect(mocks.toastSuccess).toHaveBeenCalled();
    expect(mocks.openAgentStore).not.toHaveBeenCalled();
  });

  it('connects a second account instead of copying a Composio connection', async () => {
    const library = connector({
      agentId: null,
      id: 'row-lib',
      metadata: { composio: { connectedAccountId: 'ca_1' } },
    });

    await setup().create(library);

    // A copy would share the Composio account, and removing either would sign out both.
    expect(mocks.copyConnectorToAgent).not.toHaveBeenCalled();
    expect(mocks.openAgentStore).toHaveBeenCalledWith(AGENT);
  });

  it('says so when the own connection could not be set up', async () => {
    mocks.copyConnectorToAgent.mockRejectedValue(new Error('CONFLICT'));

    await setup().create(connector({ agentId: null, id: 'row-lib' }));

    expect(mocks.toastError).toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('keeps the own connection if the library connection was mounted elsewhere before confirmation', async () => {
    mocks.fetchConnectors.mockImplementation(async () => {
      mocks.connectors = [
        connector({ agentId: null, id: 'row-lib', metadata: { mountedByAgentId: 'other-agent' } }),
      ];
    });

    await setup().revertToLibrary(connector(), 'row-lib');

    expect(mocks.detachConnectorFromAgent).not.toHaveBeenCalled();
    expect(mocks.updateAgentConfigById).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalled();
  });

  it('preserves both the connection and plugin configuration if the fresh read fails', async () => {
    mocks.fetchConnectors.mockRejectedValueOnce(new Error('offline'));

    await setup().revertToLibrary(connector(), 'row-lib');

    expect(mocks.detachConnectorFromAgent).not.toHaveBeenCalled();
    expect(mocks.updateAgentConfigById).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalled();
  });

  it('preserves an implicit off switch when reverting to the library in a custom toolset', async () => {
    mocks.plugins = [];
    mocks.chatConfig = { toolMode: 'custom' };

    await setup().revertToLibrary(connector(), 'row-lib');

    expect(mocks.updateAgentConfigById).toHaveBeenCalledWith(AGENT, {
      plugins: [{ identifier: 'notion', mode: 'disabled' }],
    });
  });

  it('keeps the tool on when the agent goes back to the library connection', async () => {
    await setup().revertToLibrary(connector(), 'row-lib');

    expect(mocks.detachConnectorFromAgent).toHaveBeenCalledWith('row-own', AGENT, 'delete');
    // Deleting the connection takes the tool off the agent on the server, so the switch is
    // written again afterwards.
    expect(mocks.calls).toEqual(['detach', 'update']);
    expect(mocks.updateAgentConfigById).toHaveBeenCalledWith(AGENT, {
      plugins: [{ identifier: 'notion', mode: 'auto' }],
    });
  });

  it('leaves the tool off when it was off before going back to the library connection', async () => {
    mocks.plugins = [{ identifier: 'notion', mode: 'disabled' }];

    await setup().revertToLibrary(connector(), 'row-lib');

    expect(mocks.updateAgentConfigById).toHaveBeenCalledWith(AGENT, {
      plugins: [{ identifier: 'notion', mode: 'disabled' }],
    });
  });

  it('removes a tool only this agent has together with its connection', async () => {
    await setup().remove(connector({ identifier: 'sentry', id: 'row-sentry' }));

    expect(mocks.updateAgentConfigById).toHaveBeenCalledWith(AGENT, {
      plugins: [{ identifier: 'notion', mode: 'auto' }],
    });
    expect(mocks.detachConnectorFromAgent).toHaveBeenCalledWith('row-sentry', AGENT, 'delete');
    expect(mocks.calls).toEqual(['update', 'detach']);
  });

  it('closes the details of a tool whose connection just changed, and leaves other details open', async () => {
    const detail = { icon: null, tag: 'Custom connector', title: 'Notion', tools: [] };
    useItemDetailStore.getState().open({ ...detail, identifier: 'notion' });
    await setup().revertToLibrary(connector(), 'row-lib');
    expect(useItemDetailStore.getState().detail).toBeUndefined();

    useItemDetailStore.getState().open({ ...detail, identifier: 'linear' });
    await setup().revertToLibrary(connector(), 'row-lib');
    expect(useItemDetailStore.getState().detail?.identifier).toBe('linear');
    useItemDetailStore.getState().close();
  });

  it('opens the library on the agent’s own connection to manage it', () => {
    setup().manage(connector());

    expect(mocks.navigate).toHaveBeenCalledWith(ownConnectionSettingsPath('row-own'));
    expect(ownConnectionSettingsPath('row-own')).toBe(
      '/marketplace/connector/installed?open=agent-connector%3Arow-own',
    );
  });
});
