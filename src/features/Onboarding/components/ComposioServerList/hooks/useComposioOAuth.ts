import { useCallback, useEffect, useRef, useState } from 'react';

import { useToolStore } from '@/store/tool';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;
const WINDOW_CLOSED_POLL_TIMEOUT_MS = 4000; // Shorter timeout when window is closed

interface UseComposioOAuthProps {
  serverStatus?: ComposioServerStatus;
}

export const useComposioOAuth = ({ serverStatus }: UseComposioOAuthProps) => {
  const [isWaitingAuth, setIsWaitingAuth] = useState(false);

  const oauthWindowRef = useRef<Window | null>(null);
  const windowCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshComposioConnectionStatus = useToolStore((s) => s.refreshComposioConnectionStatus);

  const cleanup = useCallback(() => {
    if (windowCheckIntervalRef.current) {
      clearInterval(windowCheckIntervalRef.current);
      windowCheckIntervalRef.current = null;
    }
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    oauthWindowRef.current = null;
    setIsWaitingAuth(false);
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  useEffect(() => {
    if (serverStatus === ComposioServerStatus.ACTIVE && isWaitingAuth) {
      cleanup();
    }
  }, [serverStatus, isWaitingAuth, cleanup]);

  const startFallbackPolling = useCallback(
    (serverName: string, timeoutMs: number = POLL_TIMEOUT_MS) => {
      if (pollIntervalRef.current) return;

      pollIntervalRef.current = setInterval(async () => {
        try {
          await refreshComposioConnectionStatus(serverName);
        } catch (error) {
          console.info('[Composio] Polling check (expected during auth):', error);
        }
      }, POLL_INTERVAL_MS);

      pollTimeoutRef.current = setTimeout(() => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setIsWaitingAuth(false);
      }, timeoutMs);
    },
    [refreshComposioConnectionStatus],
  );

  const startWindowMonitor = useCallback(
    (oauthWindow: Window, serverName: string) => {
      windowCheckIntervalRef.current = setInterval(() => {
        try {
          if (oauthWindow.closed) {
            // Stop monitoring window
            if (windowCheckIntervalRef.current) {
              clearInterval(windowCheckIntervalRef.current);
              windowCheckIntervalRef.current = null;
            }
            oauthWindowRef.current = null;

            // Start polling to check auth status after window closes
            // Use shorter timeout since user has closed the window
            // Keep loading state until we confirm success or timeout
            startFallbackPolling(serverName, WINDOW_CLOSED_POLL_TIMEOUT_MS);
          }
        } catch {
          if (windowCheckIntervalRef.current) {
            clearInterval(windowCheckIntervalRef.current);
            windowCheckIntervalRef.current = null;
          }
          // Use default timeout for fallback polling
          startFallbackPolling(serverName);
        }
      }, 500);
    },
    [startFallbackPolling],
  );

  const openOAuthWindow = useCallback(
    (redirectUrl: string, serverName: string) => {
      cleanup();
      setIsWaitingAuth(true);

      const oauthWindow = window.open(redirectUrl, '_blank', 'width=600,height=700');
      if (oauthWindow) {
        oauthWindowRef.current = oauthWindow;
        startWindowMonitor(oauthWindow, serverName);
      } else {
        startFallbackPolling(serverName);
      }
    },
    [cleanup, startWindowMonitor, startFallbackPolling],
  );

  return {
    isWaitingAuth,
    openOAuthWindow,
  };
};
