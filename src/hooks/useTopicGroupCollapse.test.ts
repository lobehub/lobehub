import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';

import { useTopicGroupCollapse } from './useTopicGroupCollapse';

const TIME_GROUPS = ['favorite', 'today', 'yesterday', 'week'];
const PROJECT_GROUPS = ['favorite', 'project:/repo/a', 'project:/repo/b'];

const setCollapsed = (byMode: Record<string, string[]>) => {
  useGlobalStore.setState({
    isStatusInit: true,
    status: { ...useGlobalStore.getState().status, collapsedTopicGroupKeysByMode: byMode },
  });
};

beforeEach(() => {
  vi.spyOn(useGlobalStore.getState().statusStorage, 'saveToLocalStorage').mockResolvedValue(
    undefined,
  );
  setCollapsed({});
});

describe('useTopicGroupCollapse', () => {
  it('expands every group when nothing has been collapsed yet', () => {
    const { result } = renderHook(() => useTopicGroupCollapse('byTime', TIME_GROUPS));

    expect(result.current.expandedKeys).toEqual(TIME_GROUPS);
  });

  it('keeps byProject keys from collapsing the byTime groups', () => {
    setCollapsed({ byProject: ['project:/repo/a'] });

    const { result } = renderHook(() => useTopicGroupCollapse('byTime', TIME_GROUPS));

    expect(result.current.expandedKeys).toEqual(TIME_GROUPS);
  });

  it('writes collapsed keys into the current mode bucket only', () => {
    setCollapsed({ byTime: ['week'] });

    const { result } = renderHook(() => useTopicGroupCollapse('byProject', PROJECT_GROUPS));

    act(() => {
      result.current.setExpandedKeys(['favorite', 'project:/repo/b']);
    });

    expect(useGlobalStore.getState().status.collapsedTopicGroupKeysByMode).toEqual({
      byProject: ['project:/repo/a'],
      byTime: ['week'],
    });
  });

  it('expands a group that appears after the collapsed list was persisted', () => {
    setCollapsed({ byProject: ['project:/repo/a'] });

    const { result } = renderHook(() =>
      useTopicGroupCollapse('byProject', [...PROJECT_GROUPS, 'project:/repo/new']),
    );

    expect(result.current.expandedKeys).toEqual([
      'favorite',
      'project:/repo/b',
      'project:/repo/new',
    ]);
  });

  it('preserves the collapsed state of groups that are not currently rendered', () => {
    setCollapsed({ byProject: ['project:/repo/paged-out'] });

    const { result } = renderHook(() => useTopicGroupCollapse('byProject', PROJECT_GROUPS));

    act(() => {
      result.current.setExpandedKeys(['favorite', 'project:/repo/a']);
    });

    expect(useGlobalStore.getState().status.collapsedTopicGroupKeysByMode?.byProject).toEqual([
      'project:/repo/paged-out',
      'project:/repo/b',
    ]);
  });
});
