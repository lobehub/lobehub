import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useLocalMachineDeviceIds } from '@/hooks/useLocalMachineDeviceIds';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useProjectDirectories, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

import { useScopedSidebarTopics } from '../useScopedTopics';
import { useAgentTopicGroupMode } from './useAgentTopicGroupMode';

/**
 * The sidebar's top-level topic groups — the agent's own list, or the
 * project-scoped one when a scope is mounted. The accordion and its
 * expand/collapse-all toggle read the same groups, so their ids always match.
 */
export const useSidebarTopicGroups = () => {
  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);
  const topicSortBy = useUserStore(preferenceSelectors.topicSortBy);
  const topicIncludeCompleted = useUserStore(preferenceSelectors.topicIncludeCompleted);
  const { topicGroupMode } = useAgentTopicGroupMode();

  const scoped = useScopedSidebarTopics(
    topicPageSize,
    topicSortBy,
    topicGroupMode,
    topicIncludeCompleted,
  );

  // An agent's topics are placed on a device by their project directory when
  // they carry no explicit device binding, so by-device grouping needs the
  // directory registry. The project-scoped list loads its own.
  const needsDirectories = !scoped.scope && topicGroupMode === 'byDevice';
  useProjectDirectoryStore((s) => s.useFetchDirectories)(undefined, needsDirectories);
  const directories = useProjectDirectories();

  const localDeviceIds = useLocalMachineDeviceIds();
  const groupSelector = useMemo(
    () =>
      topicSelectors.groupedTopicsForSidebar(
        topicPageSize,
        topicSortBy,
        topicGroupMode,
        topicIncludeCompleted,
        localDeviceIds,
        needsDirectories ? directories : undefined,
      ),
    [
      topicPageSize,
      topicSortBy,
      topicGroupMode,
      topicIncludeCompleted,
      localDeviceIds,
      needsDirectories,
      directories,
    ],
  );
  const agentGroups = useChatStore(groupSelector, isEqual);

  return {
    groups: scoped.scope ? scoped.groups : agentGroups,
    scoped,
    topicGroupMode,
  };
};
