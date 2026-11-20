'use client';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Outlet } from 'react-router';

import { isDesktop } from '@/const/version';
import SimpleTitleBar from '@/features/Electron/titlebar/SimpleTitleBar';

/**
 * The Electron main window is frameless (`frame: false`). Without a title bar,
 * `/onboarding` could not be dragged on macOS and would have no window
 * controls on Windows/Linux, so Desktop wraps it like `/desktop-onboarding`.
 */
const OnboardingRouteLayout = memo(() => {
  if (!isDesktop) return <Outlet />;

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <SimpleTitleBar />
      <Flexbox height={`calc(100% - ${TITLE_BAR_HEIGHT}px)`} width={'100%'}>
        <Outlet />
      </Flexbox>
    </Flexbox>
  );
});

OnboardingRouteLayout.displayName = 'OnboardingRouteLayout';

export default OnboardingRouteLayout;
