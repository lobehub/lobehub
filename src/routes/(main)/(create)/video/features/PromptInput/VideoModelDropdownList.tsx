'use client';

import { memo } from 'react';

import GenerationModelDropdownList from '@/routes/(main)/(create)/features/GenerationModelDropdownList';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/slices/aiProvider/selectors';
import { useVideoStore } from '@/store/video';
import { videoGenerationConfigSelectors } from '@/store/video/selectors';

import { VideoModelItem } from '../ConfigPanel';

const VideoModelDropdownList = memo(() => {
  const enabledVideoModelList = useAiInfraStore(aiProviderSelectors.enabledVideoModelList);

  return (
    <GenerationModelDropdownList
      ModelItemComponent={VideoModelItem}
      enabledModelList={enabledVideoModelList}
      useStore={useVideoStore}
      configSelectors={{
        model: videoGenerationConfigSelectors.model,
        provider: videoGenerationConfigSelectors.provider,
      }}
    />
  );
});

VideoModelDropdownList.displayName = 'VideoModelDropdownList';

export default VideoModelDropdownList;
