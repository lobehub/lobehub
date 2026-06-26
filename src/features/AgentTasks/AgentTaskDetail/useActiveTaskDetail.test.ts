/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useActiveTaskDetail } from './useActiveTaskDetail';

const mocks = vi.hoisted(() => ({
  agentState: {} as any,
  isLogin: true as boolean | undefined,
  taskState: {} as any,
}));

vi.mock('@/store/user', () => ({
  useUserStore: () => mocks.isLogin,
}));

vi.mock('@/store/user/selectors', () => ({
  authSelectors: { isLogin: (s: any) => s?.isLogin },
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: any) => selector(mocks.taskState),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: any) => selector(mocks.agentState),
}));

const buildTaskState = (
  overrides: {
    agentId?: string | null;
    detail?: boolean;
    taskError?: unknown;
  } = {},
) => {
  const { agentId = 'agt_assignee', detail = true, taskError } = overrides;
  return {
    activeTaskId: undefined,
    setActiveTaskId: vi.fn(),
    taskDetailMap: detail ? { 'T-194': { agentId } } : {},
    // `useFetchTaskDetail` is read off the store and called with the id.
    useFetchTaskDetail: () => ({ error: taskError }),
  };
};

const buildAgentState = (overrides: { inMap?: boolean; isLoading?: boolean } = {}) => {
  const { inMap = false, isLoading = false } = overrides;
  return {
    agentMap: inMap ? { agt_assignee: { id: 'agt_assignee' } } : {},
    useHydrateAgentConfig: () => ({ isLoading }),
  };
};

describe('useActiveTaskDetail', () => {
  beforeEach(() => {
    mocks.isLogin = true;
    mocks.taskState = buildTaskState();
    mocks.agentState = buildAgentState();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT deadlock when the assignee agent was deleted / moved to another workspace', () => {
    // The ownership-scoped fetch resolves to null: SWR settles (isLoading=false),
    // the agent never lands in agentMap, and there is no error. The detail page
    // must still render instead of spinning forever.
    mocks.taskState = buildTaskState({ agentId: 'agt_moved_away' });
    mocks.agentState = buildAgentState({ inMap: false, isLoading: false });

    const { result } = renderHook(() => useActiveTaskDetail('T-194'));

    expect(result.current.isInitialLoading).toBe(false);
    expect(result.current.isNotFound).toBe(false);
  });

  it('keeps the skeleton up while the assignee config fetch is genuinely in-flight', () => {
    mocks.agentState = buildAgentState({ inMap: false, isLoading: true });

    const { result } = renderHook(() => useActiveTaskDetail('T-194'));

    expect(result.current.isInitialLoading).toBe(true);
  });

  it('releases once the assignee config is hydrated into the map', () => {
    mocks.agentState = buildAgentState({ inMap: true, isLoading: false });

    const { result } = renderHook(() => useActiveTaskDetail('T-194'));

    expect(result.current.isInitialLoading).toBe(false);
  });

  it('does not block on the assignee when the task has no assignee', () => {
    mocks.taskState = buildTaskState({ agentId: null });
    mocks.agentState = buildAgentState({ inMap: false, isLoading: true });

    const { result } = renderHook(() => useActiveTaskDetail('T-194'));

    expect(result.current.isInitialLoading).toBe(false);
  });

  it('stays loading while the task detail itself is still resolving', () => {
    mocks.taskState = buildTaskState({ detail: false });

    const { result } = renderHook(() => useActiveTaskDetail('T-194'));

    expect(result.current.isInitialLoading).toBe(true);
    expect(result.current.isNotFound).toBe(false);
  });

  it('reports not-found when the task fetch errored and there is no cached detail', () => {
    mocks.taskState = buildTaskState({ detail: false, taskError: new Error('not found') });

    const { result } = renderHook(() => useActiveTaskDetail('T-194'));

    expect(result.current.isNotFound).toBe(true);
    expect(result.current.isInitialLoading).toBe(false);
  });
});
