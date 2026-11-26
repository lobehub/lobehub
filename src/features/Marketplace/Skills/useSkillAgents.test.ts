import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSkillAgents } from './useSkillAgents';

const service = vi.hoisted(() => ({
  getPluginAgentModes: vi.fn(),
  setPluginMode: vi.fn(),
}));
const agentStore = vi.hoisted(() => ({
  agentMap: {} as Record<string, object>,
  internal_dispatchAgentMap: vi.fn(),
}));
const toastError = vi.hoisted(() => vi.fn());

const agents = [
  { id: 'agt_a', title: 'A', type: 'agent' },
  { id: 'agt_b', title: 'B', type: 'agent' },
  { id: 'agt_c', title: 'C', type: 'agent' },
  { heterogeneousType: 'claude-code', id: 'agt_cc', title: 'CC', type: 'agent' },
  { id: 'grp_1', title: 'G', type: 'group' },
];

vi.mock('@lobehub/ui', () => ({ toast: { error: toastError } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/services/agent', () => ({ agentService: service }));
vi.mock('@/store/agent', () => ({ useAgentStore: { getState: () => agentStore } }));
vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: object) => unknown) =>
    selector({ useFetchAgentList: () => undefined }),
}));
vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: { allAgents: () => agents },
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({
  authSelectors: { isLogin: () => true },
  userProfileSelectors: { userId: () => 'user_1' },
}));

const ids = (list: { agent?: { id: string }; id?: string }[]) =>
  list.map((item) => item.agent?.id ?? item.id);

beforeEach(() => {
  service.getPluginAgentModes.mockReset();
  service.setPluginMode.mockReset();
  agentStore.agentMap = {};
  agentStore.internal_dispatchAgentMap.mockReset();
  toastError.mockReset();
});

describe('useSkillAgents', () => {
  it('splits my assistants by the modes the server reports, in one query', async () => {
    service.getPluginAgentModes.mockResolvedValue([
      { agentId: 'agt_a', mode: 'pinned' },
      { agentId: 'agt_b', mode: 'disabled' },
    ]);

    const { result } = renderHook(() => useSkillAgents('pptx', true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(service.getPluginAgentModes).toHaveBeenCalledTimes(1);
    expect(service.getPluginAgentModes).toHaveBeenCalledWith('pptx');
    expect(result.current.added).toEqual([
      { agent: agents[0], enabled: true },
      { agent: agents[1], enabled: false },
    ]);
    expect(ids(result.current.available)).toEqual(['agt_c']);
  });

  it('does not query until the skill is installed', () => {
    renderHook(() => useSkillAgents('pptx', false));
    expect(service.getPluginAgentModes).not.toHaveBeenCalled();
  });

  it('toggles through one server write and patches a loaded config', async () => {
    service.getPluginAgentModes.mockResolvedValue([{ agentId: 'agt_a', mode: 'pinned' }]);
    agentStore.agentMap = { agt_a: {} };
    const plugins = ['web', { identifier: 'pptx', mode: 'disabled' }];
    service.setPluginMode.mockResolvedValue([{ id: 'agt_a', plugins }]);

    const { result } = renderHook(() => useSkillAgents('pptx', true));
    await waitFor(() => expect(result.current.added).toHaveLength(1));

    await act(() => result.current.toggle('agt_a', false));

    expect(service.setPluginMode).toHaveBeenCalledWith({
      agentIds: ['agt_a'],
      identifier: 'pptx',
      mode: 'disabled',
    });
    expect(result.current.added).toEqual([{ agent: agents[0], enabled: false }]);
    expect(agentStore.internal_dispatchAgentMap).toHaveBeenCalledWith('agt_a', { plugins });
    expect(result.current.pendingIds).toEqual([]);
  });

  it('removes from all assistants in a single atomic write', async () => {
    service.getPluginAgentModes.mockResolvedValue([
      { agentId: 'agt_a', mode: 'pinned' },
      { agentId: 'agt_b', mode: 'disabled' },
    ]);
    service.setPluginMode.mockResolvedValue([
      { id: 'agt_a', plugins: [] },
      { id: 'agt_b', plugins: ['web'] },
    ]);

    const { result } = renderHook(() => useSkillAgents('pptx', true));
    await waitFor(() => expect(result.current.added).toHaveLength(2));

    await act(() => result.current.removeAll());

    expect(service.setPluginMode).toHaveBeenCalledTimes(1);
    expect(service.setPluginMode).toHaveBeenCalledWith({
      agentIds: undefined,
      identifier: 'pptx',
      mode: 'auto',
    });
    expect(result.current.added).toEqual([]);
    expect(ids(result.current.available)).toEqual(['agt_a', 'agt_b', 'agt_c']);
  });

  it('reads the server state back and tells the user when a write fails', async () => {
    service.getPluginAgentModes.mockResolvedValue([]);
    service.setPluginMode.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useSkillAgents('pptx', true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.add('agt_c'));

    expect(toastError).toHaveBeenCalledWith('market.skills.agents.failed');
    await waitFor(() => expect(service.getPluginAgentModes).toHaveBeenCalledTimes(2));
    expect(result.current.added).toEqual([]);
  });
});
