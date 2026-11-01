/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useGoalTopicMenu } from './useGoalTopicMenu';

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('@/features/PageEditor/Copilot/TopicSelector/useDropdownMenu', () => ({
  useDropdownMenu: () => () => [
    { key: 'markCompleted' },
    { key: 'rename' },
    { type: 'divider' },
    { key: 'duplicate' },
    { type: 'divider' },
    { key: 'delete' },
  ],
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigateMock,
}));

describe('useGoalTopicMenu', () => {
  it('leads the standard topic menu with a jump to the original topic', () => {
    const { result } = renderHook(() =>
      useGoalTopicMenu({ agentId: 'agt_1', topicId: 'tpc_1', topicTitle: 'Progress' }),
    );

    const items = result.current() as { key?: string; onClick?: () => void; type?: string }[];
    expect(items.map((item) => item.key ?? item.type)).toEqual([
      'openTopic',
      'divider',
      'markCompleted',
      'rename',
      'divider',
      'duplicate',
      'divider',
      'delete',
    ]);

    items[0].onClick?.();
    expect(navigateMock).toHaveBeenCalledWith('/agent/agt_1/tpc_1');
  });

  // Archive, duplicate and delete each switch the shared active topic, which
  // would move a goal's locked panel off its supervision record.
  it('drops the actions that leave the topic when the panel is locked', () => {
    const { result } = renderHook(() =>
      useGoalTopicMenu({
        agentId: 'agt_1',
        topicId: 'tpc_1',
        topicLocked: true,
        topicTitle: 'Progress',
      }),
    );

    const items = result.current() as { key?: string; type?: string }[];
    expect(items.map((item) => item.key ?? item.type)).toEqual(['openTopic', 'divider', 'rename']);
  });
});
