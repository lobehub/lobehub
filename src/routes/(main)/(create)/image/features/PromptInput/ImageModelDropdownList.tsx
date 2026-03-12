'use client';

import { memo } from 'react';

import GenerationModelDropdownList from '@/routes/(main)/(create)/features/GenerationModelDropdownList';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/slices/aiProvider/selectors';
import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';

import { ImageModelItem } from '../ConfigPanel';

const ImageModelDropdownList = memo(() => {
  const enabledImageModelList = useAiInfraStore(aiProviderSelectors.enabledImageModelList);

  return (
    <GenerationModelDropdownList
      ModelItemComponent={ImageModelItem}
      enabledModelList={enabledImageModelList}
      useStore={useImageStore}
      configSelectors={{
        model: imageGenerationConfigSelectors.model,
        provider: imageGenerationConfigSelectors.provider,
      }}
    />
  );
});

ImageModelDropdownList.displayName = 'ImageModelDropdownList';

export default ImageModelDropdownList;
