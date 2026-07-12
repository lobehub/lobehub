import { ActionIcon } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { Maximize2, Minimize2 } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTopicGroupCollapse } from '@/hooks/useTopicGroupCollapse';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

import { useAgentTopicGroupMode } from './hooks/useAgentTopicGroupMode';

const ToggleGroups = memo(() => {
  const { t } = useTranslation('topic');
  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);
  const topicSortBy = useUserStore(preferenceSelectors.topicSortBy);
  const { topicGroupMode } = useAgentTopicGroupMode();

  const groupSelector = useMemo(
    () => topicSelectors.groupedTopicsForSidebar(topicPageSize, topicSortBy, topicGroupMode),
    [topicPageSize, topicSortBy, topicGroupMode],
  );
  const groupTopics = useChatStore(groupSelector, isEqual);

  const groupIds = useMemo(() => groupTopics.map((group) => group.id), [groupTopics]);
  const { expandedKeys, setExpandedKeys } = useTopicGroupCollapse(topicGroupMode, groupIds);
  const isAllCollapsed = expandedKeys.length === 0;

  // flat mode renders FlatMode (no accordion), so the toggle has nothing to affect;
  // also hide when there is at most one group, where toggling is meaningless
  if (topicGroupMode === 'flat' || groupIds.length < 2) return null;

  return (
    <ActionIcon
      icon={isAllCollapsed ? Maximize2 : Minimize2}
      size={'small'}
      title={isAllCollapsed ? t('sidebar.expandAll') : t('sidebar.collapseAll')}
      onClick={() => setExpandedKeys(isAllCollapsed ? groupIds : [])}
    />
  );
});

export default ToggleGroups;
