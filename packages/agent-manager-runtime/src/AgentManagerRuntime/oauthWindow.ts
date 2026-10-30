import { getToolStoreState } from '@/store/tool';
import { composioStoreSelectors } from '@/store/tool/selectors';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore/types';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

/**
 * Open a Composio OAuth popup and wait until the connection is active, the
 * popup closes, or polling times out.
 */
export const openComposioOAuthWindowAndWait = (
  redirectUrl: string,
  identifier: string,
): Promise<{ cancelled: boolean; success: boolean }> => {
  const checkAuthStatus = async (): Promise<boolean> => {
    try {
      await getToolStoreState().refreshComposioConnectionStatus(identifier);
      const freshToolStore = getToolStoreState();
      const server = composioStoreSelectors
        .getServers(freshToolStore)
        .find((s) => s.identifier === identifier);
      return server?.status === ComposioServerStatus.ACTIVE;
    } catch {
      return false;
    }
  };

  return new Promise((resolve) => {
    const WINDOW_CHECK_INTERVAL_MS = 500;
    const POLL_INTERVAL_MS = 1000;
    const POLL_TIMEOUT_MS = 300_000;

    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let pollTimeout: ReturnType<typeof setTimeout> | null = null;
    let windowCheckInterval: ReturnType<typeof setInterval> | null = null;
    let resolved = false;

    const cleanup = () => {
      if (windowCheckInterval) clearInterval(windowCheckInterval);
      if (pollInterval) clearInterval(pollInterval);
      if (pollTimeout) clearTimeout(pollTimeout);
    };

    const resolveOnce = (result: { cancelled: boolean; success: boolean }) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    const startFallbackPolling = () => {
      if (pollInterval) return;
      pollInterval = setInterval(async () => {
        const isConnected = await checkAuthStatus();
        if (isConnected) resolveOnce({ cancelled: false, success: true });
      }, POLL_INTERVAL_MS);
      pollTimeout = setTimeout(
        () => resolveOnce({ cancelled: true, success: false }),
        POLL_TIMEOUT_MS,
      );
    };

    const oauthWindow = window.open(redirectUrl, '_blank', 'width=600,height=700');

    if (oauthWindow) {
      windowCheckInterval = setInterval(async () => {
        try {
          if (oauthWindow.closed) {
            if (windowCheckInterval) clearInterval(windowCheckInterval);
            const isConnected = await checkAuthStatus();
            resolveOnce({ cancelled: !isConnected, success: isConnected });
          }
        } catch {
          if (windowCheckInterval) clearInterval(windowCheckInterval);
          startFallbackPolling();
        }
      }, WINDOW_CHECK_INTERVAL_MS);
    } else {
      startFallbackPolling();
    }
  });
};

/**
 * Open a LobeHub Skill OAuth popup and wait for the callback page message,
 * the popup closing, or the polling timeout.
 */
export const openLobehubSkillOAuthWindowAndWait = (
  redirectUrl: string,
  provider: string,
): Promise<{ cancelled: boolean; success: boolean }> => {
  const checkAuthStatus = async (): Promise<boolean> => {
    try {
      const server = await getToolStoreState().checkLobehubSkillStatus(provider);
      return server?.status === LobehubSkillStatus.CONNECTED;
    } catch {
      return false;
    }
  };

  return new Promise((resolve) => {
    const WINDOW_CHECK_INTERVAL_MS = 500;
    const POLL_INTERVAL_MS = 1000;
    const POLL_TIMEOUT_MS = 300_000;

    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let pollTimeout: ReturnType<typeof setTimeout> | null = null;
    let windowCheckInterval: ReturnType<typeof setInterval> | null = null;
    let messageHandler: ((event: MessageEvent) => void) | null = null;
    let resolved = false;

    const cleanup = () => {
      if (windowCheckInterval) clearInterval(windowCheckInterval);
      if (pollInterval) clearInterval(pollInterval);
      if (pollTimeout) clearTimeout(pollTimeout);
      if (messageHandler) window.removeEventListener('message', messageHandler);
    };

    const resolveOnce = (result: { cancelled: boolean; success: boolean }) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    messageHandler = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'LOBEHUB_SKILL_AUTH_SUCCESS' && event.data?.provider === provider) {
        const server = await getToolStoreState().checkLobehubSkillStatus(provider);
        const isConnected = server?.status === LobehubSkillStatus.CONNECTED;
        resolveOnce({ cancelled: false, success: isConnected });
      }
    };

    window.addEventListener('message', messageHandler);

    const startFallbackPolling = () => {
      if (pollInterval) return;
      pollInterval = setInterval(async () => {
        const isConnected = await checkAuthStatus();
        if (isConnected) resolveOnce({ cancelled: false, success: true });
      }, POLL_INTERVAL_MS);
      pollTimeout = setTimeout(
        () => resolveOnce({ cancelled: true, success: false }),
        POLL_TIMEOUT_MS,
      );
    };

    const oauthWindow = window.open(redirectUrl, '_blank', 'width=600,height=700');

    if (oauthWindow) {
      windowCheckInterval = setInterval(async () => {
        try {
          if (oauthWindow.closed) {
            if (windowCheckInterval) clearInterval(windowCheckInterval);
            const isConnected = await checkAuthStatus();
            resolveOnce({ cancelled: !isConnected, success: isConnected });
          }
        } catch {
          if (windowCheckInterval) clearInterval(windowCheckInterval);
          startFallbackPolling();
        }
      }, WINDOW_CHECK_INTERVAL_MS);
    } else {
      startFallbackPolling();
    }
  });
};
