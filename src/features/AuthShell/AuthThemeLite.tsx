'use client';

import 'antd/dist/reset.css';

import { ConfigProvider, ThemeProvider } from '@lobehub/ui';
import { App } from 'antd';
import { domMax, LazyMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import AntdStaticMethods from '@/components/AntdStaticMethods';
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
        <AntdStaticMethods />
        <ConfigProvider
          motion={m}
          config={{
            aAs: Link,
            imgAs: Image,
            imgUnoptimized: true,
            proxy: globalCDN ? 'unpkg' : undefined,
          }}
        >
          <LazyMotion features={domMax}>{children}</LazyMotion>
        </ConfigProvider>
      </App>
    </ThemeProvider>
  );
});

AuthThemeLite.displayName = 'AuthThemeLite';

export default AuthThemeLite;
