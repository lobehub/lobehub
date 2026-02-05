import React, { memo,Suspense } from 'react';

import ImageTopicPanel from '@/features/ImageTopicPanel';

import Topics from './Topics';
import TopicsSkeleton from './Topics/SkeletonList';
import TopicUrlSync from './Topics/TopicUrlSync';

const TopicSidebar = memo(() => {
  return (
    <ImageTopicPanel>
      <Suspense fallback={<TopicsSkeleton />}>
        <Topics />
        <TopicUrlSync />
      </Suspense>
    </ImageTopicPanel>
  );
});

TopicSidebar.displayName = 'ImageTopicSidebar';

export default TopicSidebar;
