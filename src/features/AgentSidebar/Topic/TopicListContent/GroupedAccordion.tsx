'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { type ComponentType, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useFetchChatTopics } from '@/hooks/useFetchChatTopics';
import { useTopicGroupCollapse } from '@/hooks/useTopicGroupCollapse';
import { useChatStore } from '@/store/chat';
import {
  useCurrentChatTopics,
  useGroupedChatTopicsForSidebar,
} from '@/store/chat/slices/topic/projection';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';
import { type GroupedTopic } from '@/types/topic';

import { useAgentTopicGroupMode } from '../hooks/useAgentTopicGroupMode';
import { useNavigateToAgentTopics } from '../hooks/useTopicNavigation';

export interface GroupItemComponentProps {
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

  const activeAgentId = useChatStore((state) => state.activeAgentId);
  const topicView = useCurrentChatTopics();
  const hasMore = Boolean(topicView?.hasMore || (topicView?.total ?? 0) > topicPageSize);
  const { isExpandingPageSize } = useFetchChatTopics();
  const groupTopics = useGroupedChatTopicsForSidebar(
    topicPageSize,
    topicSortBy,
    topicGroupMode,
    topicIncludeCompleted,
  );

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
          <GroupItem expanded={expandedKeys.includes(group.id)} group={group} key={group.id} />
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
