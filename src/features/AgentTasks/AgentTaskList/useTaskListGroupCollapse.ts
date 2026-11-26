import { useCallback, useMemo } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

type CollapseEntry = { keys: string[]; scope: string };

const EMPTY_KEYS: string[] = [];

/** Oldest views are dropped past this, so visiting many agents cannot grow the status blob forever. */
export const MAX_STORED_TASK_LIST_COLLAPSE_SCOPES = 50;

/**
 * Which view a set of folded groups belongs to: the page scope
 * (`taskListFilterScopeKey`: workspace + global / agent / project page) plus
 * the tab, so "All tasks" and each "My tasks" tab fold independently, as
 * Linear keeps one set per view.
 */
export const taskListCollapseScopeKey = (pageScope: string, tab: string) => `${pageScope}:${tab}`;

/**
 * Prefix a collapse key with the grouping it was folded under. A top-level
 * group depends only on `groupBy`, so changing the sub-grouping keeps it
 * folded; a sub-group depends on both. The prefix also keeps a `none` group of
 * one grouping from folding the same-named group of another.
 */
export const qualifyTaskListCollapseKey = (key: string, groupBy: string, subGroupBy: string) =>
  key.startsWith('sub:') ? `${groupBy}>${subGroupBy}/${key}` : `${groupBy}/${key}`;

/**
 * The stored list with `scope` set to `keys` (or removed when empty). The
 * touched scope moves to the end, so trimming keeps the most recently used.
 */
export const upsertTaskListCollapseEntry = (
  entries: readonly CollapseEntry[],
  scope: string,
  keys: string[],
): CollapseEntry[] => {
  const rest = entries.filter((entry) => entry.scope !== scope);
  const next = keys.length > 0 ? [...rest, { keys, scope }] : rest;
  return next.slice(-MAX_STORED_TASK_LIST_COLLAPSE_SCOPES);
};

/**
 * Folded group / sub-group headers of one task list view, persisted so a
 * folded group stays folded across navigation and reloads. Returned keys are
 * the ones `flattenTaskListEntries` checks (`taskGroupCollapseKey` /
 * `taskSubGroupCollapseKey`); a group that appears later is absent from the
 * list and therefore starts expanded.
 */
export const useTaskListGroupCollapse = (scope: string, groupBy: string, subGroupBy: string) => {
  const stored =
    useGlobalStore(systemStatusSelectors.taskListCollapsedGroupKeys(scope)) ?? EMPTY_KEYS;
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const collapsedKeys = useMemo<ReadonlySet<string>>(() => {
    const groupPrefix = `${groupBy}/`;
    const subPrefix = `${groupBy}>${subGroupBy}/`;
    const keys = new Set<string>();
    for (const item of stored) {
      if (item.startsWith(groupPrefix)) keys.add(item.slice(groupPrefix.length));
      else if (item.startsWith(subPrefix)) keys.add(item.slice(subPrefix.length));
    }
    return keys;
  }, [groupBy, stored, subGroupBy]);

  const toggleCollapsed = useCallback(
    (key: string) => {
      const qualified = qualifyTaskListCollapseKey(key, groupBy, subGroupBy);
      // Read the store at click time: two lists on one page may toggle before
      // either re-renders with the other's write.
      const state = useGlobalStore.getState();
      const current = systemStatusSelectors.taskListCollapsedGroupKeys(scope)(state) ?? EMPTY_KEYS;
      const next = current.includes(qualified)
        ? current.filter((item) => item !== qualified)
        : [...current, qualified];

      updateSystemStatus(
        {
          taskListCollapsedGroups: upsertTaskListCollapseEntry(
            systemStatusSelectors.taskListCollapsedGroups(state),
            scope,
            next,
          ),
        },
        'toggleTaskListGroupCollapsed',
      );
    },
    [groupBy, scope, subGroupBy, updateSystemStatus],
  );

  return { collapsedKeys, toggleCollapsed };
};
