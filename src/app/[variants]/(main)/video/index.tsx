'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';

import VideoWorkspace from './features/VideoWorkspace';

const DesktopVideoPage = memo(() => {
  return (
    <>
      <NavHeader right={<WideScreenButton />} />
      <Flexbox height={'100%'} style={{ overflowY: 'auto', position: 'relative' }} width={'100%'}>
        <WideScreenContainer height={'100%'} wrapperStyle={{ height: '100%' }}>
          <VideoWorkspace />
        </WideScreenContainer>
      </Flexbox>
    </>
  );
});

DesktopVideoPage.displayName = 'DesktopVideoPage';

export default DesktopVideoPage;
