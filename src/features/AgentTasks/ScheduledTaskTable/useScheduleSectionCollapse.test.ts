import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { useScheduleSectionCollapse } from './useScheduleSectionCollapse';

const SCHEDULED = 'ws:global:scheduled';

beforeEach(() => {
  vi.spyOn(useGlobalStore.getState().statusStorage, 'saveToLocalStorage').mockResolvedValue(
    undefined,
  );
  useGlobalStore.setState({
    isStatusInit: true,
    status: { ...useGlobalStore.getState().status, taskListCollapsedGroups: [] },
  });
});

describe('useScheduleSectionCollapse', () => {
  it('keeps a folded section folded after the table unmounts and mounts again', () => {
    const first = renderHook(() => useScheduleSectionCollapse(SCHEDULED));
    act(() => first.result.current.toggleCollapsed('scheduled'));
    first.unmount();

    const second = renderHook(() => useScheduleSectionCollapse(SCHEDULED));
    expect([...second.result.current.collapsedKeys]).toEqual(['scheduled']);
    expect(
      systemStatusSelectors.taskListCollapsedGroupKeys(SCHEDULED)(useGlobalStore.getState()),
    ).toEqual(['schedule/scheduled']);
  });

  it('does not fold a same-named group of another view', () => {
    const scheduled = renderHook(() => useScheduleSectionCollapse(SCHEDULED));
    act(() => scheduled.result.current.toggleCollapsed('running'));

    const other = renderHook(() => useScheduleSectionCollapse('ws:global:tasks'));
    expect(other.result.current.collapsedKeys.size).toBe(0);
  });
});
