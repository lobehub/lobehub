import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';

import { taskGroupCollapseKey, taskSubGroupCollapseKey } from './taskListVirtualModel';
import {
  MAX_STORED_TASK_LIST_COLLAPSE_SCOPES,
  upsertTaskListCollapseEntry,
  useTaskListGroupCollapse,
} from './useTaskListGroupCollapse';

const backlog = taskGroupCollapseKey('backlog');
const backlogHigh = taskSubGroupCollapseKey('backlog', 'high');
const ALL_TASKS = 'ws:global:tasks';
const MY_ASSIGNED = 'ws:global:mine:assigned';

const setPersisted = (entries: { keys: string[]; scope: string }[]) => {
  useGlobalStore.setState({
    isStatusInit: true,
    status: { ...useGlobalStore.getState().status, taskListCollapsedGroups: entries },
  });
};

let saveToLocalStorage: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  saveToLocalStorage = vi
    .spyOn(useGlobalStore.getState().statusStorage, 'saveToLocalStorage')
    .mockResolvedValue(undefined);
  setPersisted([]);
});

describe('useTaskListGroupCollapse', () => {
  it('keeps a folded group folded after the list unmounts and mounts again', () => {
    const first = renderHook(() => useTaskListGroupCollapse(ALL_TASKS, 'status', 'none'));

    act(() => first.result.current.toggleCollapsed(backlog));
    first.unmount();

    const second = renderHook(() => useTaskListGroupCollapse(ALL_TASKS, 'status', 'none'));

    expect(second.result.current.collapsedKeys).toEqual(new Set([backlog]));
    expect(saveToLocalStorage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taskListCollapsedGroups: [{ keys: ['status/group:backlog'], scope: ALL_TASKS }],
      }),
    );
  });

  it('unfolds a group on the second toggle and drops the empty view entry', () => {
    setPersisted([{ keys: ['status/group:backlog'], scope: ALL_TASKS }]);
    const { result } = renderHook(() => useTaskListGroupCollapse(ALL_TASKS, 'status', 'none'));

    act(() => result.current.toggleCollapsed(backlog));

    expect(result.current.collapsedKeys.size).toBe(0);
    expect(useGlobalStore.getState().status.taskListCollapsedGroups).toEqual([]);
  });

  it('keeps each view folded on its own', () => {
    const all = renderHook(() => useTaskListGroupCollapse(ALL_TASKS, 'status', 'none'));
    const mine = renderHook(() => useTaskListGroupCollapse(MY_ASSIGNED, 'status', 'none'));

    act(() => all.result.current.toggleCollapsed(backlog));

    expect(all.result.current.collapsedKeys).toEqual(new Set([backlog]));
    expect(mine.result.current.collapsedKeys.size).toBe(0);
  });

  it('does not fold a same-named group of another grouping', () => {
    setPersisted([{ keys: ['priority/group:none'], scope: ALL_TASKS }]);

    const { result } = renderHook(() => useTaskListGroupCollapse(ALL_TASKS, 'project', 'none'));

    expect(result.current.collapsedKeys.size).toBe(0);
  });

  it('keeps top-level folds across sub-grouping changes but scopes sub-group folds', () => {
    const { result, rerender } = renderHook(
      ({ subGroupBy }) => useTaskListGroupCollapse(ALL_TASKS, 'status', subGroupBy),
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

describe('upsertTaskListCollapseEntry', () => {
  it('keeps only the most recently touched views', () => {
    const entries = Array.from({ length: MAX_STORED_TASK_LIST_COLLAPSE_SCOPES }, (_, index) => ({
      keys: ['status/group:backlog'],
      scope: `view-${index}`,
    }));

    const next = upsertTaskListCollapseEntry(entries, 'view-new', ['status/group:todo']);

    expect(next).toHaveLength(MAX_STORED_TASK_LIST_COLLAPSE_SCOPES);
    expect(next[0].scope).toBe('view-1');
    expect(next.at(-1)).toEqual({ keys: ['status/group:todo'], scope: 'view-new' });
  });
});
