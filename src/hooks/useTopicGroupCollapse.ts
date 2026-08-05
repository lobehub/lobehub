import { useCallback, useMemo } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { type TopicGroupMode } from '@/types/topic';

const EMPTY_KEYS: string[] = [];

/**
 * Accordion state for the topic sidebar groups, expanded by default.
 *
 * The persisted list holds the *collapsed* keys, bucketed per group mode: a group
 * that only shows up later (a new project directory, a new month bucket) is absent
 * from the list and therefore starts expanded, and `project:*` keys can never bleed
 * into byTime, where they would match nothing and collapse every group.
 */
export const useTopicGroupCollapse = (mode: TopicGroupMode, groupIds: string[]) => {
  const collapsedKeys =
    useGlobalStore(systemStatusSelectors.collapsedTopicGroupKeys(mode)) ?? EMPTY_KEYS;
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const expandedKeys = useMemo(
    () => groupIds.filter((id) => !collapsedKeys.includes(id)),
    [groupIds, collapsedKeys],
  );

  const setExpandedKeys = useCallback(
    (keys: string[]) => {
      const nextCollapsed = [
        // groups that aren't rendered right now (paged out, or emptied) keep their state
        ...collapsedKeys.filter((id) => !groupIds.includes(id)),
        ...groupIds.filter((id) => !keys.includes(id)),
      ];

      updateSystemStatus({ collapsedTopicGroupKeysByMode: { [mode]: nextCollapsed } });
    },
    [collapsedKeys, groupIds, mode, updateSystemStatus],
  );

  return { expandedKeys, setExpandedKeys };
};
