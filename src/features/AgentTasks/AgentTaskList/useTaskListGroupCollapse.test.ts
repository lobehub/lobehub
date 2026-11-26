import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';

import { taskGroupCollapseKey, taskSubGroupCollapseKey } from './taskListVirtualModel';
import { useTaskListGroupCollapse } from './useTaskListGroupCollapse';

const backlog = taskGroupCollapseKey('backlog');
const backlogHigh = taskSubGroupCollapseKey('backlog', 'high');

const setPersisted = (byGrouping: Record<string, string[]>) => {
  useGlobalStore.setState({
    isStatusInit: true,
    status: {
      ...useGlobalStore.getState().status,
      taskListCollapsedGroupKeysByGrouping: byGrouping,
    },
  });
};

let saveToLocalStorage: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  saveToLocalStorage = vi
    .spyOn(useGlobalStore.getState().statusStorage, 'saveToLocalStorage')
    .mockResolvedValue(undefined);
  setPersisted({});
});

describe('useTaskListGroupCollapse', () => {
  it('keeps a folded group folded after the list unmounts and mounts again', () => {
    const first = renderHook(() => useTaskListGroupCollapse('status', 'none'));

    act(() => first.result.current.toggleCollapsed(backlog));
    first.unmount();

    const second = renderHook(() => useTaskListGroupCollapse('status', 'none'));

    expect(second.result.current.collapsedKeys).toEqual(new Set([backlog]));
    expect(saveToLocalStorage).toHaveBeenLastCalledWith(
      expect.objectContaining({ taskListCollapsedGroupKeysByGrouping: { status: [backlog] } }),
    );
  });

  it('unfolds a group on the second toggle', () => {
    setPersisted({ status: [backlog] });
    const { result } = renderHook(() => useTaskListGroupCollapse('status', 'none'));

    act(() => result.current.toggleCollapsed(backlog));

    expect(result.current.collapsedKeys.size).toBe(0);
  });

  it('does not fold a same-named group of another grouping', () => {
    setPersisted({ priority: [taskGroupCollapseKey('none')] });

    const { result } = renderHook(() => useTaskListGroupCollapse('project', 'none'));

    expect(result.current.collapsedKeys.size).toBe(0);
  });

  it('keeps top-level folds across sub-grouping changes but scopes sub-group folds', () => {
    const { result, rerender } = renderHook(
      ({ subGroupBy }) => useTaskListGroupCollapse('status', subGroupBy),
      { initialProps: { subGroupBy: 'priority' } },
    );

    act(() => result.current.toggleCollapsed(backlog));
    act(() => result.current.toggleCollapsed(backlogHigh));
    expect(result.current.collapsedKeys).toEqual(new Set([backlog, backlogHigh]));

    rerender({ subGroupBy: 'assignee' });
    expect(result.current.collapsedKeys).toEqual(new Set([backlog]));

    rerender({ subGroupBy: 'priority' });
    expect(result.current.collapsedKeys).toEqual(new Set([backlog, backlogHigh]));
  });
});
