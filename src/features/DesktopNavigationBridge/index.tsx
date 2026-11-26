'use client';

import { type MainBroadcastParams, useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { memo, useCallback, useEffect } from 'react';

import { getActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { openDirectoryInApp } from '@/features/AppLaunch/openDirectory';
import { getTabRouter } from '@/features/Electron/TabHost/tabRouterManager';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useElectronStore } from '@/store/electron';
import { ensureElectronIpc } from '@/utils/electron/ipc';

const DesktopNavigationBridge = memo(() => {
  const navigate = useWorkspaceAwareNavigate();
  const handleNavigate = useCallback(
    ({ escape, path, replace, reuseTab }: MainBroadcastParams<'navigate'>) => {
      if (!path) return;
      if (reuseTab) {
        const url = buildWorkspaceAwarePath(path, getActiveWorkspaceSlug(), { escape });
        const current = useElectronStore.getState();
        if (current.getActiveTab()?.url === url) return;
        const id = current.addTab(url);
        // Tab identity ignores fragments. Deliver the exact deep link to a
        // matching live router, or seed its next mount if it was evicted.
        const state = useElectronStore.getState();
        if (state.getActiveTab()?.url !== url) {
          const router = getTabRouter(id);
          if (router) void router.navigate(url, { replace });
          else state.updateTab(id, url);
        }
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

  /**
   * A shell launch (`lh app .`, `LobeHub ~/Code/app`, Finder's "Open With")
   * arrives as a canonical directory. It lands here rather than in
   * `ProtocolUrlHandler` because that component only mounts inside the agent
   * and group layouts — a second `lh app` while the app sits on a project page
   * would reach no listener at all.
   */
  const handleOpenDirectory = useCallback(
    ({ newWindow, path }: { newWindow: boolean; path: string }) => {
      void openDirectoryInApp({
        navigate,
        // `--new-window` means "don't take over the conversation I already have".
        reuseExisting: !newWindow,
        targetPath: path,
      }).catch((error) => {
        console.error('[DesktopNavigationBridge] Failed to open directory:', error);
      });
    },
    [navigate],
  );

  useWatchBroadcast('navigate', handleNavigate);
  useWatchBroadcast('openDirectory', handleOpenDirectory);

  /**
   * Tell the main process the listeners above exist. A launch that arrives
   * during a cold start is held there instead of being sent into a page that
   * has not subscribed yet — without this handshake it was dropped silently and
   * the app opened its ordinary landing page.
   */
  useEffect(() => {
    void ensureElectronIpc()
      .appLaunch.clientReady()
      .catch((error: unknown) => {
        console.error('[DesktopNavigationBridge] Failed to report readiness:', error);
      });
  }, []);

  return null;
});

DesktopNavigationBridge.displayName = 'DesktopNavigationBridge';

export default DesktopNavigationBridge;
