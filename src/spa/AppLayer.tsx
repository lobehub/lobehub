'use client';

import type { PropsWithChildren } from 'react';
import { memo } from 'react';

import { useAppReady } from './atoms/app';

const AppLayer = memo<PropsWithChildren>(({ children }) => {
  const appReady = useAppReady();

  return appReady ? <>{children}</> : null;
});

AppLayer.displayName = 'AppLayer';

export default AppLayer;
