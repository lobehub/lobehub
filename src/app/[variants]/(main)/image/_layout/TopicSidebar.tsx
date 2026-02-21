import { Suspense, memo } from 'react';

import {
  GenerationTopicStoreProvider,
  SkeletonList,
  TopicList,
  TopicUrlSync,
} from '@/features/GenerationTopicList';
import ImageTopicPanel from '@/features/ImageTopicPanel';
import { useImageStore } from '@/store/image';

const TopicSidebar = memo(() => {
  return (
    <GenerationTopicStoreProvider value={{ namespace: 'image', useStore: useImageStore as any }}>
      <ImageTopicPanel>
        <Suspense fallback={<SkeletonList />}>
          <TopicList />
          <TopicUrlSync />
        </Suspense>
      </ImageTopicPanel>
    </GenerationTopicStoreProvider>
  );
});

TopicSidebar.displayName = 'ImageTopicSidebar';

export default TopicSidebar;
