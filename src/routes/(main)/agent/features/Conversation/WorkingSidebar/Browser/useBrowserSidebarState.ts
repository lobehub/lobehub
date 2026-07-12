import { isDesktop } from '@lobechat/const';
import type { BrowserSidebarState } from '@lobechat/electron-client-ipc';
import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { useEffect, useMemo, useState } from 'react';

import { electronBrowserSidebarService } from '@/services/electron/browserSidebar';

export const createInitialBrowserState = (
  sessionId: string,
  initialUrl?: string,
): BrowserSidebarState => ({
  attached: false,
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  sessionId,
  title: '',
  url: initialUrl ?? '',
});

export const useBrowserSidebarState = (sessionId?: string, initialUrl?: string) => {
  const fallbackState = useMemo(
    () => createInitialBrowserState(sessionId ?? 'browser', initialUrl),
    [initialUrl, sessionId],
  );
  const [state, setState] = useState<BrowserSidebarState>(fallbackState);

  useEffect(() => {
    setState(fallbackState);
  }, [fallbackState]);

  useWatchBroadcast('browserSidebarStateChanged', (nextState) => {
    if (nextState.sessionId !== sessionId) return;
    setState(nextState);
  });

  useEffect(() => {
    if (!isDesktop || !sessionId) return;

    let ignore = false;

    electronBrowserSidebarService
      .getState({ sessionId })
      .then((nextState) => {
        if (!ignore) setState(nextState);
      })
      .catch((error) => {
        console.error('[BrowserSidebar] Failed to get browser state:', error);
      });

    return () => {
      ignore = true;
    };
  }, [sessionId]);

  return state;
};
