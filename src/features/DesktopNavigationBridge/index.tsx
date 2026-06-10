'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { memo, useCallback } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

const DesktopNavigationBridge = memo(() => {
  const navigate = useWorkspaceAwareNavigate();

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
