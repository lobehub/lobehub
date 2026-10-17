/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGoalAgentModel } from './useGoalAgentModel';

const mocks = vi.hoisted(() => ({
  config: {} as {
    manager?: object;
    model?: string;
    provider?: string;
    taskAgentId?: string;
    taskModel?: string;
    taskProvider?: string;
  },
  loadedAgents: new Set(['agt_old', 'agt_exec']),
  lockedAgents: new Set<string>(),
  navigate: vi.fn(),
  memberPicks: {} as Record<string, string>,
  preferenceLoading: false,
  settingsReady: true,
  setGoalAgent: vi.fn(),
  setGoalModel: vi.fn(),
  setGoalTaskAgent: vi.fn(),
  setGoalTaskModel: vi.fn(),
}));

vi.mock('@/store/goal', () => ({
  goalSelectors: {
    goalGraph: () => () => ({ goal: { agentId: 'agt_old', config: mocks.config } }),
  },
  useGoalStore: (selector: (s: any) => unknown) =>
    selector({
      setGoalAgent: mocks.setGoalAgent,
      setGoalModel: mocks.setGoalModel,
      setGoalTaskAgent: mocks.setGoalTaskAgent,
      setGoalTaskModel: mocks.setGoalTaskModel,
    }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: any) => unknown) =>
    selector({
      agentMap: Object.fromEntries([...mocks.loadedAgents].map((id) => [id, {}])),
      useHydrateAgentConfig: () => {},
    }),
}));

// The Agent row's own model, which a Task created for it is pinned to.
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentModelById: (id: string) => () => (id === 'agt_exec' ? 'deepseek-chat' : 'gpt-4o-mini'),
    getAgentModelProviderById: (id: string) => () => (id === 'agt_exec' ? 'deepseek' : 'openai'),
  },
}));

// The caller's effective model for an agent, as the chat model trigger reads it:
// a member's own pick (`memberPicks`) wins over the Agent row.
vi.mock('@/features/ChatInput/hooks/useAgentModelSelection', () => ({
  useAgentModelSelection: (id: string) => ({
    isPreferenceLoading: mocks.preferenceLoading,
    model: mocks.memberPicks[id] ?? (id === 'agt_exec' ? 'deepseek-chat' : 'gpt-4o-mini'),
    provider: mocks.memberPicks[id] ? 'google' : id === 'agt_exec' ? 'deepseek' : 'openai',
    selectionPolicy: mocks.lockedAgents.has(id) ? 'fixed' : 'member',
    usesWorkspaceMemberSelection: mocks.lockedAgents.has(id),
  }),
}));

vi.mock('@/store/home', () => ({ useHomeStore: (selector: (s: any) => unknown) => selector({}) }));
vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: { getAgentById: () => () => undefined },
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: any) => unknown) =>
    selector({ isUserStateInit: mocks.settingsReady }),
}));
vi.mock('@/store/user/selectors', () => ({
  authSelectors: { isLogin: () => true },
  systemAgentSelectors: { goal: () => ({ model: 'system-goal', provider: 'system-provider' }) },
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Main-agent planning turns, so the planner falls back to the agent's model.
  mocks.config = { manager: {} };
  mocks.memberPicks = {};
  mocks.settingsReady = true;
  mocks.loadedAgents = new Set(['agt_old', 'agt_exec']);
  mocks.lockedAgents = new Set();
  mocks.preferenceLoading = false;
});

describe('useGoalAgentModel', () => {
  it('follows the goal to the new agent route after a handover', async () => {
    const { result } = renderHook(() =>
      useGoalAgentModel({ goalId: 'goal_1', routeAgentId: 'agt_old' }),
    );

    await act(() => result.current.planner.changeAgent('agt_new'));

    expect(mocks.setGoalAgent).toHaveBeenCalledWith('goal_1', 'agt_new');
    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agt_new/goal/goal_1', { replace: true });
  });

  it('stays on an agent-less route after a handover', async () => {
    const { result } = renderHook(() => useGoalAgentModel({ goalId: 'goal_1' }));

    await act(() => result.current.planner.changeAgent('agt_new'));

    expect(mocks.setGoalAgent).toHaveBeenCalledWith('goal_1', 'agt_new');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("shows the agent's own model until the goal overrides it", () => {
    const { result, rerender } = renderHook(() => useGoalAgentModel({ goalId: 'goal_1' }));
    expect(result.current.planner.model).toEqual({ model: 'gpt-4o-mini', provider: 'openai' });

    mocks.config = { manager: {}, model: 'gemini-3.8-flash', provider: 'google' };
    rerender();
    expect(result.current.planner.model).toEqual({ model: 'gemini-3.8-flash', provider: 'google' });
  });

  it("stores an override, and clears it when the agent's own model is picked", async () => {
    const { result } = renderHook(() => useGoalAgentModel({ goalId: 'goal_1' }));

    await act(() =>
      result.current.planner.changeModel({ model: 'gemini-3.8-flash', provider: 'google' }),
    );
    expect(mocks.setGoalModel).toHaveBeenLastCalledWith('goal_1', {
      model: 'gemini-3.8-flash',
      provider: 'google',
    });

    await act(() =>
      result.current.planner.changeModel({ model: 'gpt-4o-mini', provider: 'openai' }),
    );
    expect(mocks.setGoalModel).toHaveBeenLastCalledWith('goal_1', null);
  });

  it('routes Tasks to a dedicated executor, and back when the main agent is picked', async () => {
    const { result, rerender } = renderHook(() => useGoalAgentModel({ goalId: 'goal_1' }));

    await act(() => result.current.executor.changeAgent('agt_exec'));
    expect(mocks.setGoalTaskAgent).toHaveBeenLastCalledWith('goal_1', 'agt_exec');

    mocks.config = { taskAgentId: 'agt_exec' };
    rerender();
    expect(result.current.executor.agentId).toBe('agt_exec');

    await act(() => result.current.executor.changeAgent('agt_old'));
    expect(mocks.setGoalTaskAgent).toHaveBeenLastCalledWith('goal_1', null);
  });

  it('skips the write when the executor does not change', async () => {
    const { result } = renderHook(() => useGoalAgentModel({ goalId: 'goal_1' }));

    // No dedicated executor yet, so picking the main agent changes nothing.
    await act(() => result.current.executor.changeAgent('agt_old'));
    expect(mocks.setGoalTaskAgent).not.toHaveBeenCalled();
  });

  it("shows the executor's own model, falling back to the main agent's", () => {
    const { result, rerender } = renderHook(() => useGoalAgentModel({ goalId: 'goal_1' }));
    expect(result.current.executor.model).toEqual({ model: 'gpt-4o-mini', provider: 'openai' });

    mocks.config = { taskAgentId: 'agt_exec' };
    rerender();
    expect(result.current.executor.model).toEqual({ model: 'deepseek-chat', provider: 'deepseek' });

    mocks.config = {
      taskAgentId: 'agt_exec',
      taskModel: 'gemini-3.8-flash',
      taskProvider: 'google',
    };
    rerender();
    expect(result.current.executor.model).toEqual({
      model: 'gemini-3.8-flash',
      provider: 'google',
    });
  });

  it("stores a Task model, and clears it when the executor's own model is picked", async () => {
    mocks.config = { taskAgentId: 'agt_exec' };
    const { result } = renderHook(() => useGoalAgentModel({ goalId: 'goal_1' }));

    await act(() =>
      result.current.executor.changeModel({ model: 'gemini-3.8-flash', provider: 'google' }),
    );
    expect(mocks.setGoalTaskModel).toHaveBeenLastCalledWith('goal_1', {
      model: 'gemini-3.8-flash',
      provider: 'google',
    });

    await act(() =>
      result.current.executor.changeModel({ model: 'deepseek-chat', provider: 'deepseek' }),
    );
    expect(mocks.setGoalTaskModel).toHaveBeenLastCalledWith('goal_1', null);
  });

  it("does not store a pick before the agent's own model has loaded", async () => {
    mocks.loadedAgents = new Set();
    const { result } = renderHook(() => useGoalAgentModel({ goalId: 'goal_1' }));
    expect(result.current.planner.modelReady).toBe(false);

    await act(() =>
      result.current.planner.changeModel({ model: 'gpt-4o-mini', provider: 'openai' }),
    );
    expect(mocks.setGoalModel).not.toHaveBeenCalled();
  });

  it('locks the model of an Agent whose author fixed it', async () => {
    mocks.lockedAgents = new Set(['agt_old']);
    const { result } = renderHook(() => useGoalAgentModel({ goalId: 'goal_1' }));
    expect(result.current.planner.modelLocked).toBe(true);

    await act(() =>
      result.current.planner.changeModel({ model: 'gemini-3.8-flash', provider: 'google' }),
    );
    expect(mocks.setGoalModel).not.toHaveBeenCalled();
  });

  it('falls back to the system goal model when the coordinator plans the goal', async () => {
    mocks.config = {};
    const { result } = renderHook(() => useGoalAgentModel({ goalId: 'goal_1' }));
    expect(result.current.planner.model).toEqual({
      model: 'system-goal',
      provider: 'system-provider',
    });

    // The agent's own model is a real choice here, not the fallback.
    await act(() =>
      result.current.planner.changeModel({ model: 'gpt-4o-mini', provider: 'openai' }),
    );
    expect(mocks.setGoalModel).toHaveBeenLastCalledWith('goal_1', {
      model: 'gpt-4o-mini',
      provider: 'openai',
    });

    await act(() =>
      result.current.planner.changeModel({ model: 'system-goal', provider: 'system-provider' }),
    );
    expect(mocks.setGoalModel).toHaveBeenLastCalledWith('goal_1', null);
  });

  it('waits for user settings before accepting a coordinator planning model', async () => {
    mocks.config = {};
    mocks.settingsReady = false;
    const { result } = renderHook(() => useGoalAgentModel({ goalId: 'goal_1' }));
    expect(result.current.planner.modelReady).toBe(false);
  });

  it("plans on the member's own pick but pins Tasks to the Agent row's model", () => {
    mocks.memberPicks = { agt_old: 'gemini-member' };
    const { result } = renderHook(() => useGoalAgentModel({ goalId: 'goal_1' }));

    expect(result.current.planner.model).toEqual({ model: 'gemini-member', provider: 'google' });
    expect(result.current.executor.model).toEqual({ model: 'gpt-4o-mini', provider: 'openai' });
  });
});
