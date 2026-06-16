'use client';

import { memo, type PropsWithChildren, useLayoutEffect, useRef } from 'react';

import { useAppReady } from './atoms/app';
import { removeLoadingScreen } from './lib/app';

const AppLayer = memo<PropsWithChildren>(({ children }) => {
  const appReady = useAppReady();
  const onceReady = useRef(false);

  useLayoutEffect(() => {
    if (!appReady || onceReady.current) return;

    onceReady.current = true;
    removeLoadingScreen();
  }, [appReady]);

  return appReady ? <>{children}</> : null;
});

AppLayer.displayName = 'AppLayer';

export default AppLayer;
