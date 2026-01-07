'use client';

import { Flexbox } from '@lobehub/ui';
import { Suspense, memo } from 'react';

import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';

import ImageWorkspace from './features/ImageWorkspace';
import SkeletonList from './features/ImageWorkspace/SkeletonList';

const DesktopImagePage = memo(() => {
  return (
    <>
      <NavHeader right={<WideScreenButton />} />
      <Flexbox height={'100%'} style={{ overflowY: 'auto', position: 'relative' }} width={'100%'}>
        <WideScreenContainer height={'100%'} wrapperStyle={{ height: '100%' }}>
          <Suspense fallback={<SkeletonList />}>
            <ImageWorkspace />
          </Suspense>
        </WideScreenContainer>
      </Flexbox>
    </>
  );
});

DesktopImagePage.displayName = 'DesktopImagePage';

export default DesktopImagePage;
