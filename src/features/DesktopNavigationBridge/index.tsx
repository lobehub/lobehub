'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { clearDesktopOnboardingCompleted } from '@/app/[variants]/(desktop)/desktop-onboarding/storage';

const DesktopNavigationBridge = memo(() => {
  const navigate = useNavigate();

  const handleNavigate = useCallback(
    ({ path, replace }: { path: string; replace?: boolean }) => {
      if (!path) return;
      navigate(path, { replace: !!replace });
    },
    [navigate],
  );

  useWatchBroadcast('navigate', handleNavigate);

  const handleAuthorizationRequired = useCallback(() => {
    clearDesktopOnboardingCompleted();
    navigate('/desktop-onboarding#5', { replace: true });
  }, [navigate]);

  useWatchBroadcast('authorizationRequired', handleAuthorizationRequired);

  return null;
});

DesktopNavigationBridge.displayName = 'DesktopNavigationBridge';

export default DesktopNavigationBridge;
