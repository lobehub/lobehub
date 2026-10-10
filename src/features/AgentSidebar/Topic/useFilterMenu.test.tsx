/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTopicFilterDropdownMenu } from './useFilterMenu';

const scopeMock = vi.hoisted(() => ({ scope: null as null | { projectId: string } }));
const groupModeMock = vi.hoisted(() => ({ mode: 'byTime' as string }));
const preferenceMock = vi.hoisted(() => ({
  topicSortBy: 'updatedAt',
  topicIncludeCompleted: true,
  updatePreference: vi.fn(),
}));
const updateAgentModeMock = vi.hoisted(() => vi.fn());

vi.mock('./TopicListScope', () => ({
  useTopicListScope: () => scopeMock.scope,
}));

vi.mock('./hooks/useAgentTopicGroupMode', () => ({
  useAgentTopicGroupMode: () => ({
    topicGroupMode: groupModeMock.mode,
    updateTopicGroupMode: updateAgentModeMock,
  }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) =>
    selector({
      updatePreference: preferenceMock.updatePreference,
    }),
}));

vi.mock('@/store/user/selectors', () => ({
  preferenceSelectors: {
    topicSortBy: () => preferenceMock.topicSortBy,
    topicIncludeCompleted: () => preferenceMock.topicIncludeCompleted,
  },
}));

const organizeLabels = (items: any[]): string[] => {
  const organize = items.find((item) => item.key === 'organize');
  return organize.children.map((child: any) => child.label);
};

describe('useTopicFilterDropdownMenu group modes', () => {
  beforeEach(() => {
    scopeMock.scope = null;
    groupModeMock.mode = 'byTime';
    vi.clearAllMocks();
  });

  /** @example A single agent's own sidebar must not offer grouping by agent. */
  it('hides by agent in an unscoped agent sidebar', () => {
    const { result } = renderHook(() => useTopicFilterDropdownMenu());

    expect(organizeLabels(result.current())).toEqual([
      'filter.groupMode.byStatus',
      'filter.groupMode.byTime',
      'filter.groupMode.byProject',
      'filter.groupMode.flat',
    ]);
  });

  /** @example The project sidebar keeps by agent because its topics span agents. */
  it('offers by agent inside a project-scoped list', () => {
    scopeMock.scope = { projectId: 'prj-1' };

    const { result } = renderHook(() => useTopicFilterDropdownMenu());

    expect(organizeLabels(result.current())).toEqual([
      'filter.groupMode.byStatus',
      'filter.groupMode.byTime',
      'filter.groupMode.byProject',
      'filter.groupMode.byAgent',
      'filter.groupMode.flat',
    ]);
  });
});
