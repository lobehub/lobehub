'use client';

import 'antd/dist/reset.css';

import { ConfigProvider, ThemeProvider } from '@lobehub/ui';
import { ToastHost } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { domMax, LazyMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import { useIsDark } from '@/hooks/useIsDark';
import Image from '@/libs/next/Image';
import Link from '@/libs/next/Link';

interface AuthThemeLiteProps extends PropsWithChildren {
  globalCDN?: boolean;
}

const AuthThemeLite = memo<AuthThemeLiteProps>(({ children, globalCDN }) => {
  const isDark = useIsDark();
  const currentAppearance = isDark ? 'dark' : 'light';

  return (
    <ConfigProvider
      motion={m}
      config={{
        aAs: Link,
        imgAs: Image,
        imgUnoptimized: true,
        proxy: globalCDN ? 'unpkg' : undefined,
      }}
    >
      <ThemeProvider
        appearance={currentAppearance}
        className={'auth-layout'}
        defaultAppearance={currentAppearance}
        defaultThemeMode={currentAppearance}
        style={{ height: '100%' }}
        theme={{
          cssVar: { key: 'lobe-vars' },
        }}
      >
        <App style={{ height: '100%' }}>
          <LazyMotion features={domMax}>{children}</LazyMotion>
          <ToastHost />
        </App>
      </ThemeProvider>
    </ConfigProvider>
  );
});

AuthThemeLite.displayName = 'AuthThemeLite';

export default AuthThemeLite;
