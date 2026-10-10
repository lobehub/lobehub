'use client';

import '@lobehub/ui/theme.css';
import '@lobehub/ui/global.css';
import '@lobehub/ui/style.css';

import { ConfigProvider, ToastHost  } from '@lobehub/ui';
import { domMax, LazyMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import Image from '@/libs/next/Image';
import Link from '@/libs/next/Link';

interface AuthThemeLiteProps extends PropsWithChildren {
  globalCDN?: boolean;
}

const AuthThemeLite = memo<AuthThemeLiteProps>(({ children, globalCDN }) => {
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
      <div className={'auth-layout'} style={{ height: '100%' }}>
        <LazyMotion features={domMax}>{children}</LazyMotion>
        <ToastHost />
      </div>
    </ConfigProvider>
  );
});

AuthThemeLite.displayName = 'AuthThemeLite';

export default AuthThemeLite;
