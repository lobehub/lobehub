'use client';

import { Suspense, memo } from 'react';

import {
  GenerationTopicStoreProvider,
  SkeletonList,
  TopicList,
  TopicUrlSync,
} from '@/features/GenerationTopicList';
import GenerationTopicPanel from '@/features/GenerationTopicPanel';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useVideoStore } from '@/store/video';

const TopicSidebar = memo(() => {
  const [videoTopicPanelWidth, showVideoTopicPanel, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.videoTopicPanelWidth(s),
    systemStatusSelectors.showVideoTopicPanel(s),
    s.updateSystemStatus,
  ]);

  return (
    <GenerationTopicStoreProvider value={{ namespace: 'video', useStore: useVideoStore as any }}>
      <GenerationTopicPanel
        onExpandChange={(expand) => updateSystemStatus({ showVideoTopicPanel: expand })}
        onSizeChange={(width) => updateSystemStatus({ videoTopicPanelWidth: width })}
        panelWidth={videoTopicPanelWidth ?? 256}
        showPanel={showVideoTopicPanel ?? true}
      >
        <Suspense fallback={<SkeletonList />}>
          <TopicList />
          <TopicUrlSync />
        </Suspense>
      </GenerationTopicPanel>
    </GenerationTopicStoreProvider>
  );
});

TopicSidebar.displayName = 'VideoTopicSidebar';

export default TopicSidebar;
