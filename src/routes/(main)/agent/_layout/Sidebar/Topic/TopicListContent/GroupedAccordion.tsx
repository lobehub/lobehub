'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { MoreHorizontal } from 'lucide-react';
import { type ComponentType, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useTopicGroupCollapse } from '@/hooks/useTopicGroupCollapse';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';
import { type GroupedTopic } from '@/types/topic';

import { useAgentTopicGroupMode } from '../hooks/useAgentTopicGroupMode';
import { useNavigateToAgentTopics } from '../hooks/useTopicNavigation';

export interface GroupItemComponentProps {
  activeThreadId?: string;
  activeTopicId?: string;
  expanded: boolean;
  group: GroupedTopic;
}

interface GroupedAccordionProps {
  GroupItem: ComponentType<GroupItemComponentProps>;
}

const GroupedAccordion = memo<GroupedAccordionProps>(({ GroupItem }) => {
  const { t } = useTranslation('chat');
  const navigateToAgentTopics = useNavigateToAgentTopics();
  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);
  const topicSortBy = useUserStore(preferenceSelectors.topicSortBy);
  const topicIncludeCompleted = useUserStore(preferenceSelectors.topicIncludeCompleted);
  const { topicGroupMode } = useAgentTopicGroupMode();

  const [hasMore, isExpandingPageSize, activeAgentId] = useChatStore((s) => [
    topicSelectors.hasMoreTopicsForSidebar(s),
    topicSelectors.isExpandingPageSize(s),
    s.activeAgentId,
  ]);
  const [activeTopicId, activeThreadId] = useChatStore((s) => [s.activeTopicId, s.activeThreadId]);

  const groupSelector = useMemo(
    () =>
      topicSelectors.groupedTopicsForSidebar(
        topicPageSize,
        topicSortBy,
        topicGroupMode,
        topicIncludeCompleted,
      ),
    [topicPageSize, topicSortBy, topicGroupMode, topicIncludeCompleted],
  );
  const groupTopics = useChatStore(groupSelector, isEqual);

  const groupIds = useMemo(() => groupTopics.map((group) => group.id), [groupTopics]);
  const { expandedKeys, setExpandedKeys } = useTopicGroupCollapse(topicGroupMode, groupIds);

  return (
    <Flexbox gap={2}>
      <Accordion
        expandedKeys={expandedKeys}
        gap={2}
        onExpandedChange={(keys) => setExpandedKeys(keys as string[])}
      >
        {groupTopics.map((group) => (
          <GroupItem
            activeThreadId={activeThreadId}
            activeTopicId={activeTopicId}
            expanded={expandedKeys.includes(group.id)}
            group={group}
            key={group.id}
          />
        ))}
      </Accordion>
      {isExpandingPageSize && <SkeletonList rows={3} />}
      {hasMore && !isExpandingPageSize && activeAgentId && (
        <NavItem
          icon={MoreHorizontal}
          title={t('topic.viewAll')}
          onClick={() => navigateToAgentTopics(activeAgentId)}
        />
      )}
    </Flexbox>
  );
});

GroupedAccordion.displayName = 'GroupedAccordion';

export default GroupedAccordion;
