/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { merge } from '@/utils/merge';

import { useResolvedHomeAgentId, useSelectHomeAgent } from './useResolvedHomeAgentId';

const PERSONAL_SCOPE = 'user-1:personal';
const WORKSPACE_SCOPE = 'user-1:ws-1';

const mocks = vi.hoisted(() => ({
  agentState: { builtinAgentIdMap: {} as Record<string, string> },
  globalState: {
    status: {} as Record<string, unknown>,
    updateSystemStatus: (_patch: Record<string, unknown>) => {},
  },
  homeState: { agentIds: [] as string[], isAgentListInit: false },
  scope: 'user-1:personal',
}));
mocks.globalState.updateSystemStatus = (patch) => {
  mocks.globalState.status = merge(mocks.globalState.status, patch);
};

vi.mock('@/libs/swr/useCacheScope', () => ({
  useCacheScope: () => mocks.scope,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof mocks.agentState) => unknown) =>
    selector(mocks.agentState),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: typeof mocks.globalState) => unknown) =>
    selector(mocks.globalState),
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: typeof mocks.homeState) => unknown) => selector(mocks.homeState),
}));

vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: {
    getAgentById: (id: string) => (state: typeof mocks.homeState) =>
      state.agentIds.includes(id) ? { id } : undefined,
    isAgentListInit: (state: typeof mocks.homeState) => state.isAgentListInit,
  },
}));

const enterScope = (scope: string, inboxAgentId: string | undefined, agentIds: string[] = []) => {
  mocks.scope = scope;
  mocks.agentState.builtinAgentIdMap = inboxAgentId ? { inbox: inboxAgentId } : {};
  mocks.homeState.agentIds = agentIds;
};

describe('useResolvedHomeAgentId', () => {
  beforeEach(() => {
    mocks.globalState.status = {};
    mocks.homeState.isAgentListInit = false;
    enterScope(PERSONAL_SCOPE, 'agt_personal_inbox');
  });

  it('does not carry the personal selection into a workspace whose agent list is still loading', () => {
    const select = renderHook(() => useSelectHomeAgent());
    act(() => select.result.current('agt_personal_inbox'));

    // Right after a switch: the workspace inbox is known, its agent list is not.
    enterScope(WORKSPACE_SCOPE, 'agt_workspace_inbox');
    const { result } = renderHook(() => useResolvedHomeAgentId());

    expect(result.current).toEqual({ agentId: 'agt_workspace_inbox', isInbox: true });
  });

  it('resolves to nothing rather than another scope’s agent before the workspace inbox loads', () => {
    const select = renderHook(() => useSelectHomeAgent());
    act(() => select.result.current('agt_personal_agent'));

    enterScope(WORKSPACE_SCOPE, undefined);
    const { result } = renderHook(() => useResolvedHomeAgentId());

    expect(result.current.agentId).toBeUndefined();
  });

  it('keeps each scope’s own selection across switches', () => {
    const personal = renderHook(() => useSelectHomeAgent());
    act(() => personal.result.current('agt_personal_agent'));

    enterScope(WORKSPACE_SCOPE, 'agt_workspace_inbox', ['agt_workspace_agent']);
    const workspace = renderHook(() => useSelectHomeAgent());
    act(() => workspace.result.current('agt_workspace_agent'));
    expect(renderHook(() => useResolvedHomeAgentId()).result.current.agentId).toBe(
      'agt_workspace_agent',
    );

    enterScope(PERSONAL_SCOPE, 'agt_personal_inbox', ['agt_personal_agent']);
    expect(renderHook(() => useResolvedHomeAgentId()).result.current).toEqual({
      agentId: 'agt_personal_agent',
      isInbox: false,
    });
  });

  it('resets a selection the loaded agent list no longer contains to the inbox', () => {
    const select = renderHook(() => useSelectHomeAgent());
    act(() => select.result.current('agt_deleted'));
    mocks.homeState.isAgentListInit = true;

    const { result } = renderHook(() => useResolvedHomeAgentId());

    expect(result.current.agentId).toBe('agt_personal_inbox');
    expect(mocks.globalState.status.homeSelectedAgentIdByScope).toEqual({
      [PERSONAL_SCOPE]: 'agt_personal_inbox',
    });
  });
});
