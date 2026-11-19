'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { memo, useCallback } from 'react';

import { appNavigate } from '@/features/Electron/navigation/appNavigate';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

interface NavigatePayload {
  escape?: boolean;
  path: string;
  preferExistingTab?: boolean;
  replace?: boolean;
}

const DesktopNavigationBridge = memo(() => {
  const navigate = useWorkspaceAwareNavigate();

  const handleNavigate = useCallback(
    ({ escape, path, preferExistingTab, replace }: NavigatePayload) => {
      if (!path) return;
      // Notification clicks: switch to the tab already showing the target instead of
      // rewriting the focused one. Broadcasts without the flag keep the old behavior.
      if (preferExistingTab) {
        appNavigate(path, { escape: !!escape, replace: !!replace, target: 'existingTab' });
        return;
      }
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
