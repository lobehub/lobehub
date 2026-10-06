'use client';

import 'antd/dist/reset.css';

import ConfigProvider from '@lobehub/ui/es/ConfigProvider/index';
import ThemeProvider from '@lobehub/ui/es/ThemeProvider/index';
import { App } from 'antd';
import { domMax, LazyMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { memo, type PropsWithChildren } from 'react';

import { useIsDark } from '@/hooks/useIsDark';
import Image from '@/libs/next/Image';
import Link from '@/libs/next/Link';

const ShareTheme = memo<PropsWithChildren>(({ children }) => {
  const isDark = useIsDark();
  const appearance = isDark ? 'dark' : 'light';

  return (
    <ConfigProvider config={{ aAs: Link, imgAs: Image, imgUnoptimized: true }} motion={m}>
      <ThemeProvider
        appearance={appearance}
        className={'share-layout'}
        defaultAppearance={appearance}
        defaultThemeMode={appearance}
        style={{ height: '100%', minHeight: '100dvh', width: '100%' }}
        theme={{ cssVar: { key: 'lobe-vars' } }}
      >
        <App style={{ height: '100%' }}>
          <LazyMotion features={domMax}>{children}</LazyMotion>
        </App>
      </ThemeProvider>
    </ConfigProvider>
  );
});

ShareTheme.displayName = 'ShareTheme';

export default ShareTheme;
