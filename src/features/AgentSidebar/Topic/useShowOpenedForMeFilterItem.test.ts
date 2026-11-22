import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useShowOpenedForMeFilterItem } from './useShowOpenedForMeFilterItem';

const state = vi.hoisted(() => ({
  agentId: 'agt_a' as string | undefined,
  groupId: undefined as string | undefined,
  labOn: true,
  scope: undefined as object | undefined,
  shown: {} as Record<string, boolean>,
  updateSystemStatus: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./TopicListScope', () => ({ useTopicListScope: () => state.scope }));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: any) =>
    selector({ activeAgentId: state.agentId, activeGroupId: state.groupId }),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: any) =>
    selector({
      status: { topicShowOpenedForMeByAgent: state.shown },
      updateSystemStatus: state.updateSystemStatus,
    }),
}));
vi.mock('@/store/user', () => ({ useUserStore: (selector: any) => selector({}) }));
vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableBetterCodingExperience: () => state.labOn },
}));

describe('useShowOpenedForMeFilterItem', () => {
  beforeEach(() => {
    Object.assign(state, {
      agentId: 'agt_a',
      groupId: undefined,
      labOn: true,
      scope: undefined,
      shown: {},
    });
    state.updateSystemStatus.mockClear();
  });

  it('toggles the agent list filter on this device', () => {
    const { result } = renderHook(() => useShowOpenedForMeFilterItem());

    expect(result.current?.key).toBe('showOpenedForMe');
    (result.current as any).onClick();
    expect(state.updateSystemStatus).toHaveBeenCalledWith({
      topicShowOpenedForMeByAgent: { agt_a: true },
    });
  });

  it('is absent with the lab off, in a group, or in a project scope', () => {
    state.labOn = false;
    expect(renderHook(() => useShowOpenedForMeFilterItem()).result.current).toBeNull();

    state.labOn = true;
    state.groupId = 'grp';
    expect(renderHook(() => useShowOpenedForMeFilterItem()).result.current).toBeNull();

    state.groupId = undefined;
    state.scope = { projectId: 'p' };
    expect(renderHook(() => useShowOpenedForMeFilterItem()).result.current).toBeNull();
  });
});
