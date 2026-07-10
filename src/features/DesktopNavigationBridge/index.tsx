'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { memo, useCallback } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

const DesktopNavigationBridge = memo(() => {
  const navigate = useWorkspaceAwareNavigate();

  const handleNavigate = useCallback(
    ({ escape, path, replace }: { escape?: boolean; path: string; replace?: boolean }) => {
      if (!path) return;
      if (escape || replace !== undefined) {
        navigate(path, { escape: !!escape, replace: !!replace });
        return;
      }
      navigate(path);
    },
    [navigate],
  );

  useWatchBroadcast('navigate', handleNavigate);

  return null;
});

DesktopNavigationBridge.displayName = 'DesktopNavigationBridge';

export default DesktopNavigationBridge;
