'use client';

import 'antd/dist/reset.css';

import { ConfigProvider, ThemeProvider } from '@lobehub/ui';
import { App } from 'antd';
import * as motion from 'motion/react-m';
import Link from 'next/link';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import AntdStaticMethods from '@/components/AntdStaticMethods';
import { useIsDark } from '@/hooks/useIsDark';
import Image from '@/libs/next/Image';

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
          motion={motion}
          config={{
            aAs: Link,
            imgAs: Image,
            imgUnoptimized: true,
            proxy: globalCDN ? 'unpkg' : undefined,
          }}
        >
          {children}
        </ConfigProvider>
      </App>
    </ThemeProvider>
  );
});

AuthThemeLite.displayName = 'AuthThemeLite';

export default AuthThemeLite;
