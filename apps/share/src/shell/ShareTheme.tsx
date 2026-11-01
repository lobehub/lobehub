'use client';

import '@lobehub/ui/theme.css';
import '@lobehub/ui/global.css';
import '@lobehub/ui/style.css';

import ConfigProvider from '@lobehub/ui/es/ConfigProvider/index';
import { domMax, LazyMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { memo, type PropsWithChildren } from 'react';

import Image from '@/libs/next/Image';
import Link from '@/libs/next/Link';

const ShareTheme = memo<PropsWithChildren>(({ children }) => {
  return (
    <ConfigProvider config={{ aAs: Link, imgAs: Image, imgUnoptimized: true }} motion={m}>
      <div
        className={'share-layout'}
        style={{ height: '100%', minHeight: '100dvh', width: '100%' }}
      >
        <LazyMotion features={domMax}>{children}</LazyMotion>
      </div>
    </ConfigProvider>
  );
});

ShareTheme.displayName = 'ShareTheme';

export default ShareTheme;
