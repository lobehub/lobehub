import { Center, Flexbox } from '@lobehub/ui';
import { type ReactNode } from 'react';
import React, { memo } from 'react';

import { ProductLogo } from '@/components/Branding';
import { type StageItem } from '@/components/InitProgress';
import InitProgress from '@/components/InitProgress';

interface FullscreenLoadingProps {
  activeStage: number;
  contentRender?: ReactNode;
  stages: StageItem[];
}

const FullscreenLoading = memo<FullscreenLoadingProps>(({ activeStage, stages, contentRender }) => {
  return (
    <Flexbox height={'100%'} style={{ position: 'relative', userSelect: 'none' }} width={'100%'}>
      <Center flex={1} gap={16} width={'100%'}>
        <ProductLogo size={48} type={'combine'} />
        {contentRender ? contentRender : <InitProgress activeStage={activeStage} stages={stages} />}
      </Center>
    </Flexbox>
  );
});

export default FullscreenLoading;
