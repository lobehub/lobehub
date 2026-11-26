import { useCallback, useMemo } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

const EMPTY_KEYS: string[] = [];

/**
 * Bucket a collapse key is persisted under. A top-level group depends only on
 * `groupBy`, so changing the sub-grouping keeps the folded groups (as Linear
 * does); a sub-group depends on both. Bucketing also keeps a `none` key of one
 * grouping from folding the same-named group of another.
 */
export const taskListCollapseBucket = (collapseKey: string, groupBy: string, subGroupBy: string) =>
  collapseKey.startsWith('sub:') ? `${groupBy}>${subGroupBy}` : groupBy;

/**
 * Folded group / sub-group headers of the task list, persisted so a folded
 * group stays folded across navigation and reloads. Keys are the ones
 * `flattenTaskListEntries` checks (`taskGroupCollapseKey` /
 * `taskSubGroupCollapseKey`); a group that appears later is absent from the
 * list and therefore starts expanded.
 */
export const useTaskListGroupCollapse = (groupBy: string, subGroupBy: string) => {
  const groupKeys =
    useGlobalStore(systemStatusSelectors.taskListCollapsedGroupKeys(groupBy)) ?? EMPTY_KEYS;
  const subGroupKeys =
    useGlobalStore(systemStatusSelectors.taskListCollapsedGroupKeys(`${groupBy}>${subGroupBy}`)) ??
    EMPTY_KEYS;
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const collapsedKeys = useMemo<ReadonlySet<string>>(
    () => new Set([...groupKeys, ...subGroupKeys]),
    [groupKeys, subGroupKeys],
  );

  const toggleCollapsed = useCallback(
    (key: string) => {
      const bucket = taskListCollapseBucket(key, groupBy, subGroupBy);
      // Read the bucket at click time: two lists on one page may toggle
      // before either re-renders with the other's write.
      const current =
        systemStatusSelectors.taskListCollapsedGroupKeys(bucket)(useGlobalStore.getState()) ??
        EMPTY_KEYS;
      const next = current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key];

      updateSystemStatus(
        { taskListCollapsedGroupKeysByGrouping: { [bucket]: next } },
        'toggleTaskListGroupCollapsed',
      );
    },
    [groupBy, subGroupBy, updateSystemStatus],
  );

  return { collapsedKeys, toggleCollapsed };
};
