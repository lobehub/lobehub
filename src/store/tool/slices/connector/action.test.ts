import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as workspaceHooks from '@/business/client/hooks/useActiveWorkspaceId';
import { lambdaClient, toolsClient } from '@/libs/trpc/client';

import { useToolStore } from '../../store';
import { initialConnectorState } from './initialState';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: {
      list: { query: vi.fn() },
      listAgentBound: { query: vi.fn() },
      listByAgent: { query: vi.fn() },
      syncToolsFromClient: { mutate: vi.fn() },
    },
  },
  toolsClient: {
    market: {
      connectListTools: { query: vi.fn() },
    },
  },
}));

const listQuery = lambdaClient.connector.list.query as unknown as ReturnType<typeof vi.fn>;
const listAgentBoundQuery = lambdaClient.connector.listAgentBound.query as unknown as ReturnType<
  typeof vi.fn
>;
const listByAgentQuery = lambdaClient.connector.listByAgent.query as unknown as ReturnType<
  typeof vi.fn
>;

const connector = (identifier: string) => ({ id: identifier, identifier, tools: [] });

describe('syncLobehubSkillTools', () => {
  const linear = { id: 'linear-connector', identifier: 'linear', name: 'Linear' };
  const discovery = vi.mocked(toolsClient.market.connectListTools.query);
  const persist = vi.mocked(lambdaClient.connector.syncToolsFromClient.mutate);

  beforeEach(() => {
    vi.resetAllMocks();
    useToolStore.setState({ ...initialConnectorState, lobehubSkillServers: [] });
    vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue(null);
    persist.mockResolvedValue({ connectorId: linear.id, toolCount: 1 });
    listQuery.mockResolvedValue([]);
  });

  afterEach(() => vi.restoreAllMocks());

  it('should stay pending through discovery, persistence and list refresh and ignore duplicate requests', async () => {
    const discovered = Promise.withResolvers<any>();
    const persisted = Promise.withResolvers<any>();
    const refreshed = Promise.withResolvers<any>();
    discovery.mockReturnValueOnce(discovered.promise);
    persist.mockReturnValueOnce(persisted.promise);
    listQuery.mockReturnValueOnce(refreshed.promise);
    useToolStore.setState({ connectorSyncing: { unrelated: true } });

    const refresh = useToolStore.getState().syncLobehubSkillTools(linear);
    expect(useToolStore.getState().connectorSyncing).toEqual({
      [linear.id]: true,
      unrelated: true,
    });
    await useToolStore.getState().syncLobehubSkillTools(linear);
    expect(discovery).toHaveBeenCalledTimes(1);

    discovered.resolve({
      tools: [{ description: 'Save', inputSchema: { type: 'object' }, name: 'save_document' }],
    });
    await waitFor(() =>
      expect(persist).toHaveBeenCalledWith({
        id: linear.id,
        identifier: 'linear',
        name: 'Linear',
        sourceType: 'marketplace',
        tools: [
          { description: 'Save', inputSchema: { type: 'object' }, toolName: 'save_document' },
        ],
      }),
    );
    expect(useToolStore.getState().connectorSyncing[linear.id]).toBe(true);
    await useToolStore.getState().syncLobehubSkillTools(linear);
    expect(persist).toHaveBeenCalledTimes(1);

    persisted.resolve({ connectorId: linear.id, toolCount: 1 });
    await waitFor(() => expect(listQuery).toHaveBeenCalledTimes(1));
    expect(useToolStore.getState().connectorSyncing[linear.id]).toBe(true);
    await useToolStore.getState().syncLobehubSkillTools(linear);
    expect(discovery).toHaveBeenCalledTimes(1);

    refreshed.resolve([]);
    await refresh;
    expect(useToolStore.getState().connectorSyncing).toEqual({
      [linear.id]: false,
      unrelated: true,
    });
  });

  it('should persist the selected agent id and wait for the agent-bound list to refresh', async () => {
    const agent = { ...linear, agentId: 'agent-a', id: 'agent-linear-connector', tools: [] };
    const refreshed = Promise.withResolvers<any>();
    const updatedAgent = { ...agent, tools: [{ toolName: 'save_document' }] };
    discovery.mockResolvedValue({ tools: [] } as any);
    persist.mockResolvedValue({ connectorId: agent.id, toolCount: 0 });
    listQuery.mockResolvedValue([linear]);
    listAgentBoundQuery.mockReturnValueOnce(refreshed.promise);
    useToolStore.setState({
      agentBoundConnectors: [agent] as any,
      connectors: [linear] as any,
      isAgentBoundInit: true,
    });

    const refresh = useToolStore.getState().syncLobehubSkillTools(agent);
    await waitFor(() => expect(listAgentBoundQuery).toHaveBeenCalledTimes(1));
    expect(persist).toHaveBeenCalledWith({
      id: agent.id,
      identifier: 'linear',
      name: 'Linear',
      sourceType: 'marketplace',
      tools: [],
    });
    expect(useToolStore.getState().connectorSyncing[agent.id]).toBe(true);
    expect(useToolStore.getState().agentBoundConnectors).toEqual([agent]);

    refreshed.resolve([updatedAgent]);
    await refresh;
    expect(useToolStore.getState().agentBoundConnectors).toEqual([updatedAgent]);
    expect(useToolStore.getState().connectors).toEqual([linear]);
    expect(useToolStore.getState().connectorSyncing[agent.id]).toBe(false);
  });

  it.each(['discovery', 'persistence', 'list refresh'])(
    'should clear pending and allow retry after %s fails',
    async (stage) => {
      discovery.mockResolvedValue({ tools: [] } as any);
      const error = new Error('Unavailable');
      if (stage === 'discovery') discovery.mockRejectedValueOnce(error);
      if (stage === 'persistence') persist.mockRejectedValueOnce(error);
      if (stage === 'list refresh') listQuery.mockRejectedValueOnce(error);

      await expect(useToolStore.getState().syncLobehubSkillTools(linear)).rejects.toThrow();
      expect(useToolStore.getState().connectorSyncing[linear.id]).toBe(false);
      if (stage === 'discovery') expect(persist).not.toHaveBeenCalled();

      await useToolStore.getState().syncLobehubSkillTools(linear);
      expect(discovery).toHaveBeenCalledTimes(2);
      expect(useToolStore.getState().connectorSyncing[linear.id]).toBe(false);
    },
  );
});

describe('createConnectorSlice — scope guard', () => {
  beforeEach(() => {
    useToolStore.setState({ ...initialConnectorState });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  // The connector list is workspace-scoped server-side but lands in one global
  // store bucket, so a response that resolves after the active scope moved on
  // must be dropped. Booting straight into a workspace URL is exactly that: the
  // tree mounts once in personal context before the URL→store sync resolves the
  // slug, so a personal query is already in flight when the workspace switch
  // fires its own — and the personal one landing last is what made a business
  // workspace list the user's PERSONAL tools.
  it('drops a fetchConnectors response that resolves after the scope changed', async () => {
    const wsSpy = vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue(null);
    listQuery.mockImplementation(async () => {
      wsSpy.mockReturnValue('ws-1');
      return [connector('personal-tool')];
    });

    const { result } = renderHook(() => useToolStore());
    await act(async () => {
      await result.current.fetchConnectors();
    });

    expect(useToolStore.getState().connectors).toEqual([]);
    expect(useToolStore.getState().isConnectorsInit).toBe(false);
  });

  it('writes a fetchConnectors response that resolves in the same scope', async () => {
    vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue('ws-1');
    listQuery.mockResolvedValue([connector('workspace-tool')]);

    const { result } = renderHook(() => useToolStore());
    await act(async () => {
      await result.current.fetchConnectors();
    });

    expect(useToolStore.getState().connectors.map((c) => c.identifier)).toEqual(['workspace-tool']);
    expect(useToolStore.getState().isConnectorsInit).toBe(true);
  });

  it('drops a fetchAgentBoundConnectors response that resolves after the scope changed', async () => {
    const wsSpy = vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue('ws-1');
    listAgentBoundQuery.mockImplementation(async () => {
      wsSpy.mockReturnValue(null);
      return [connector('agent-bound')];
    });

    const { result } = renderHook(() => useToolStore());
    await act(async () => {
      await result.current.fetchAgentBoundConnectors();
    });

    expect(useToolStore.getState().agentBoundConnectors).toEqual([]);
    expect(useToolStore.getState().isAgentBoundInit).toBe(false);
  });

  it('drops a fetchAgentConnectors response that resolves after the scope changed', async () => {
    const wsSpy = vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue('ws-1');
    listByAgentQuery.mockImplementation(async () => {
      wsSpy.mockReturnValue('ws-2');
      return [connector('agent-owned')];
    });

    const { result } = renderHook(() => useToolStore());
    await act(async () => {
      await result.current.fetchAgentConnectors('agt_1');
    });

    expect(useToolStore.getState().agentConnectors['agt_1']).toBeUndefined();
    expect(useToolStore.getState().agentConnectorsInit['agt_1']).toBeUndefined();
  });
});
