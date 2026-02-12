import { memo } from 'react';
import { Link } from 'react-router-dom';

import GroupSkeleton from '@/app/[variants]/(main)/home/features/components/GroupSkeleton';
import { RECENT_BLOCK_SIZE } from '@/app/[variants]/(main)/home/features/const';
import { useHomeStore } from '@/store/home';
import { homeRecentSelectors } from '@/store/home/selectors';

import ReactTopicItem from './Item';

const RecentTopicList = memo(() => {
  const recentTopics = useHomeStore(homeRecentSelectors.recentTopics);
  const isInit = useHomeStore(homeRecentSelectors.isRecentTopicsInit);

  // Loading state
  if (!isInit) {
    return (
      <GroupSkeleton
        height={RECENT_BLOCK_SIZE.TOPIC.HEIGHT}
        width={RECENT_BLOCK_SIZE.TOPIC.WIDTH}
      />
    );
  }

  return recentTopics.map((topic) => {
    // Build URL based on topic type
    const topicUrl =
      topic.type === 'group' && topic.group
        ? `/group/${topic.group.id}?topic=${topic.id}`
        : `/agent/${topic?.agent?.id}?topic=${topic.id}`;

    return (
      <Link
        key={topic.id}
        to={topicUrl}
        style={{
          color: 'inherit',
          textDecoration: 'none',
        }}
      >
        <ReactTopicItem {...topic} />
      </Link>
    );
  });
});

export default RecentTopicList;
