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
const workspaceMock = vi.hoisted(() => ({
  hasActiveWorkspace: false,
  topicOnlyMine: false,
  updateWorkspaceUserPreference: vi.fn(),
}));

vi.mock('@/business/client/hooks/useHasActiveWorkspace', () => ({
  useHasActiveWorkspace: () => workspaceMock.hasActiveWorkspace,
}));

vi.mock('./TopicListScope', () => ({
  useTopicListScope: () => scopeMock.scope,
}));

vi.mock('./useProjectTopicFilterItems', () => ({
  useProjectTopicFilterItems: () => () =>
    scopeMock.scope
      ? [
          { key: 'filter-status', type: 'submenu' },
          { key: 'filter-device', type: 'submenu' },
        ]
      : [],
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
      updateWorkspaceUserPreference: workspaceMock.updateWorkspaceUserPreference,
    }),
}));

vi.mock('@/store/user/selectors', () => ({
  preferenceSelectors: {
    topicSortBy: () => preferenceMock.topicSortBy,
    topicIncludeCompleted: () => preferenceMock.topicIncludeCompleted,
  },
  workspaceUserSettingsSelectors: {
    topicOnlyMine: () => () => workspaceMock.topicOnlyMine,
  },
}));

const organizeLabels = (items: any[]): string[] => {
  const organize = items.find((item) => item.key === 'organize');
  return organize.children.map((child: any) => child.label);
};

const filterGroup = (items: any[]) => items.find((item) => item.key === 'filter');

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

  /** @example The project sidebar offers by agent and by device, and drops by project because it is already one project. */
  it('offers by agent first, then by device but not by project inside a project-scoped list', () => {
    scopeMock.scope = { projectId: 'prj-1' };

    const { result } = renderHook(() => useTopicFilterDropdownMenu());

    expect(organizeLabels(result.current())).toEqual([
      'filter.groupMode.byAgent',
      'filter.groupMode.byStatus',
      'filter.groupMode.byTime',
      'filter.groupMode.byDevice',
      'filter.groupMode.flat',
    ]);
  });

  it('puts the status and device filters ahead of the archived toggle inside a project', () => {
    scopeMock.scope = { projectId: 'prj-1' };

    const { result } = renderHook(() => useTopicFilterDropdownMenu());
    const filter = result.current().find((item: any) => item.key === 'filter') as any;

    expect(filter.children.map((child: any) => child.key)).toEqual([
      'filter-status',
      'filter-device',
      'showCompleted',
    ]);
  });

  it('keeps only the archived toggle in an agent sidebar', () => {
    const { result } = renderHook(() => useTopicFilterDropdownMenu());
    const filter = result.current().find((item: any) => item.key === 'filter') as any;

    expect(filter.children.map((child: any) => child.key)).toEqual(['showCompleted']);
  });
});

describe('useTopicFilterDropdownMenu only-mine filter', () => {
  beforeEach(() => {
    scopeMock.scope = null;
    workspaceMock.hasActiveWorkspace = false;
    workspaceMock.topicOnlyMine = false;
    vi.clearAllMocks();
  });

  /** @example Every personal topic is the caller's, so the filter would do nothing there. */
  it('hides the only-mine filter outside a workspace', () => {
    const { result } = renderHook(() => useTopicFilterDropdownMenu());

    const keys = filterGroup(result.current()).children.map((child: any) => child.key);
    expect(keys).toEqual(['showCompleted']);
  });

  it('toggles the per-workspace only-mine preference inside a workspace', () => {
    workspaceMock.hasActiveWorkspace = true;

    const { result } = renderHook(() => useTopicFilterDropdownMenu());
    const item = filterGroup(result.current()).children.find(
      (child: any) => child.key === 'onlyMine',
    );

    expect(item.label).toBe('filter.onlyMine');
    item.onClick();
    expect(workspaceMock.updateWorkspaceUserPreference).toHaveBeenCalledWith({
      topicOnlyMine: true,
    });
  });
});
