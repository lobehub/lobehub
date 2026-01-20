'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

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

  return null;
});

DesktopNavigationBridge.displayName = 'DesktopNavigationBridge';

export default DesktopNavigationBridge;
