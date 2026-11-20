/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoalConversationContext } from '../goalConversation';
import { useReleaseGateDecided } from './useReleaseGateDecided';

const refreshGoalGraph = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/store/goal', () => ({
  useGoalStore: (selector: (state: { refreshGoalGraph: () => void }) => unknown) =>
    selector({ refreshGoalGraph }),
}));

/** The hook as the goal page mounts it: with the page's conversation opener in context. */
const onGoalPage = (openConversation = vi.fn()) => {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(GoalConversationContext, { value: openConversation }, children);
  const { result } = renderHook(() => useReleaseGateDecided('goal-1'), { wrapper });
  return { decide: result.current, openConversation };
};

describe('useReleaseGateDecided', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the goal conversation after the plan is sent back, so the owner sees the correction land', async () => {
    let refreshed = false;
    refreshGoalGraph.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            refreshed = true;
            resolve();
          }, 0),
        ),
    );
    const openConversation = vi.fn(() => {
      // Opened on the goal as the send-back left it, not before.
      expect(refreshed).toBe(true);
    });
    const { decide } = onGoalPage(openConversation);

    await decide('revise');

    expect(refreshGoalGraph).toHaveBeenCalledWith('goal-1');
    expect(openConversation).toHaveBeenCalledTimes(1);
  });

  it('leaves the panel alone when the next wave is released', async () => {
    const { decide, openConversation } = onGoalPage();

    await decide('release');

    expect(refreshGoalGraph).toHaveBeenCalledWith('goal-1');
    expect(openConversation).not.toHaveBeenCalled();
  });

  it('still refreshes the goal where no page hosts its conversation', async () => {
    const { result } = renderHook(() => useReleaseGateDecided('goal-1'));

    await expect(result.current('revise')).resolves.toBeUndefined();
    expect(refreshGoalGraph).toHaveBeenCalledWith('goal-1');
  });
});
