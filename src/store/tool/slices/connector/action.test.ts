import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { lambdaClient } from '@/libs/trpc/client';

import { useToolStore } from '../../store';
import { initialConnectorState } from './initialState';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: {
      list: { query: vi.fn() },
      listAgentBound: { query: vi.fn() },
      listByAgent: { query: vi.fn() },
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

let scopeSpy: ReturnType<typeof vi.spyOn>;

describe('createConnectorSlice — scope guard', () => {
  beforeEach(() => {
    useToolStore.setState({ ...initialConnectorState });
    // The guard captures the full cache scope (user + workspace), not just the
    // workspace id, so the tests drive the scope string directly.
    scopeSpy = vi.spyOn(cacheScope, 'get').mockReturnValue('user-a:personal');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  // The connector list is identity-scoped server-side but lands in one global
  // store bucket, so a response that resolves after the active scope moved on
  // must be dropped. Booting straight into a workspace URL is exactly that: the
  // tree mounts once in personal context before the URL→store sync resolves the
  // slug, so a personal query is already in flight when the workspace switch
  // fires its own — and the personal one landing last is what made a business
  // workspace list the user's PERSONAL tools.
  it('drops a fetchConnectors response that resolves after the workspace changed', async () => {
    listQuery.mockImplementation(async () => {
      scopeSpy.mockReturnValue('user-a:ws-1');
      return [connector('personal-tool')];
    });

    const { result } = renderHook(() => useToolStore());
    await act(async () => {
      await result.current.fetchConnectors();
    });

    expect(useToolStore.getState().connectors).toEqual([]);
    expect(useToolStore.getState().isConnectorsInit).toBe(false);
  });

  // The gap a workspace-only guard leaves open: two signed-in users in personal
  // context both have a `null` workspace, so the scope must include the user or
  // user A's inventory lands in user B's partition after an account switch.
  it('drops a fetchConnectors response that resolves after the signed-in user changed', async () => {
    listQuery.mockImplementation(async () => {
      scopeSpy.mockReturnValue('user-b:personal');
      return [connector('user-a-tool')];
    });

    const { result } = renderHook(() => useToolStore());
    await act(async () => {
      await result.current.fetchConnectors();
    });

    expect(useToolStore.getState().connectors).toEqual([]);
    expect(useToolStore.getState().isConnectorsInit).toBe(false);
  });

  it('writes a fetchConnectors response that resolves in the same scope', async () => {
    listQuery.mockResolvedValue([connector('workspace-tool')]);

    const { result } = renderHook(() => useToolStore());
    await act(async () => {
      await result.current.fetchConnectors();
    });

    expect(useToolStore.getState().connectors.map((c) => c.identifier)).toEqual(['workspace-tool']);
    expect(useToolStore.getState().isConnectorsInit).toBe(true);
  });

  it('drops a fetchAgentBoundConnectors response that resolves after the scope changed', async () => {
    listAgentBoundQuery.mockImplementation(async () => {
      scopeSpy.mockReturnValue('user-b:personal');
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
    listByAgentQuery.mockImplementation(async () => {
      scopeSpy.mockReturnValue('user-a:ws-2');
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
