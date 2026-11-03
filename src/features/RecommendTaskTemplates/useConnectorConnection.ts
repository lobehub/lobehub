import type { TaskTemplateConnectorReference } from '@lobechat/const';
import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LOBEHUB_SKILL_AUTH_SUCCESS_MESSAGE } from '@/const/skillConnection';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { useToolStore } from '@/store/tool';
import { composioStoreSelectors } from '@/store/tool/slices/composioStore/selectors';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore/types';
import { lobehubSkillStoreSelectors } from '@/store/tool/slices/lobehubSkillStore/selectors';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';
import { useUserStore } from '@/store/user';

import type { ConnectorProviderMeta } from './providerMeta';
import { findNextUnconnectedSpec } from './providerMeta';

// Re-exported for callers that prefer a single import surface for the hook +
// its types/helpers. The pure helpers themselves live in `./providerMeta` so
// unit tests can import them without dragging in the store-dependency graph.
export type { ConnectorProviderMeta } from './providerMeta';
export { findNextUnconnectedSpec, getProviderMeta } from './providerMeta';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;
/** Hard cap on how long the OAuth popup-monitor keeps polling — protects against
 *  users opening the popup, switching away, and never closing it. */
const OAUTH_OVERALL_TIMEOUT_MS = 5 * 60 * 1000;

/** Thrown when the browser blocks the OAuth popup so callers can surface a clear hint. */
export class ConnectorConnectionPopupBlockedError extends Error {
  constructor() {
    super('Browser popup blocked');
    this.name = 'ConnectorConnectionPopupBlockedError';
  }
}

/** Thrown when connecting a LobeHub connector first needs Market auth. */
export class ConnectorConnectionMarketAuthRequiredError extends Error {
  constructor() {
    super('Market auth required before connecting LobeHub connector');
    this.name = 'ConnectorConnectionMarketAuthRequiredError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isMarketUnauthorizedError = (error: unknown): boolean => {
  if (!isRecord(error)) return false;
  const data = error.data;
  if (!isRecord(data)) return false;
  return data.httpStatus === 401 || data.code === 'UNAUTHORIZED';
};

type ConnectTarget = Pick<ConnectorProviderMeta, 'identifier' | 'source'>;

export interface UseConnectorConnectionResult {
  connect: () => Promise<void>;
  isAllConnected: boolean;
  isConnecting: boolean;
  /** True when there is at least one spec and at least one of them is not yet connected. */
  needsConnect: boolean;
  /** First spec in input order whose connection is missing. undefined when all connected or specs is empty. */
  nextUnconnected: ConnectorProviderMeta | undefined;
}

/**
 * Shared predicate for both `useConnectorConnection` and ad-hoc filtering
 * (e.g. hiding already-connected providers from the inline auth list).
 */
export const useIsConnectorConnected = () => {
  const lobehubServers = useToolStore(lobehubSkillStoreSelectors.getServers);
  const composioServers = useToolStore(composioStoreSelectors.getServers);

  return useCallback(
    (spec: TaskTemplateConnectorReference): boolean => {
      if (spec.source === 'lobehub') {
        return lobehubServers.some(
          (s) => s.identifier === spec.identifier && s.status === LobehubSkillStatus.CONNECTED,
        );
      }
      return composioServers.some(
        (s) => s.identifier === spec.identifier && s.status === ComposioServerStatus.ACTIVE,
      );
    },
    [lobehubServers, composioServers],
  );
};

export const useConnectorConnection = (
  specs: TaskTemplateConnectorReference[] | undefined,
): UseConnectorConnectionResult => {
  const getLobehubAuth = useToolStore((s) => s.getLobehubSkillAuthorizeUrl);
  const checkLobehubStatus = useToolStore((s) => s.checkLobehubSkillStatus);
  const createComposioConnection = useToolStore((s) => s.createComposioConnection);
  const refreshComposioConnectionStatus = useToolStore((s) => s.refreshComposioConnectionStatus);
  const { isAuthenticated: isMarketAuthenticated, signIn: signInMarket } = useMarketAuth();

  const isConnectedFor = useIsConnectorConnected();

  const nextUnconnected = useMemo(
    () => findNextUnconnectedSpec(specs, isConnectedFor),
    [specs, isConnectedFor],
  );

  const hasSpecs = (specs?.length ?? 0) > 0;
  const isAllConnected = hasSpecs && !nextUnconnected;
  const needsConnect = hasSpecs && !!nextUnconnected;

  const [isConnecting, setIsConnecting] = useState(false);
  const [isWaitingAuth, setIsWaitingAuth] = useState(false);

  const oauthWindowRef = useRef<Window | null>(null);
  const windowCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const windowCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sync lock against double-click — useState guard would only flip after re-render.
  const isConnectingRef = useRef(false);

  const cleanup = useCallback(() => {
    if (windowCheckIntervalRef.current) {
      clearInterval(windowCheckIntervalRef.current);
      windowCheckIntervalRef.current = null;
    }
    if (windowCheckTimeoutRef.current) {
      clearTimeout(windowCheckTimeoutRef.current);
      windowCheckTimeoutRef.current = null;
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

  useEffect(() => () => cleanup(), [cleanup]);

  useEffect(() => {
    if (isWaitingAuth && !nextUnconnected) cleanup();
  }, [isWaitingAuth, nextUnconnected, cleanup]);

  const startFallbackPolling = useCallback(
    (target: ConnectTarget) => {
      if (pollIntervalRef.current) return;

      pollIntervalRef.current = setInterval(async () => {
        try {
          if (target.source === 'lobehub') {
            await checkLobehubStatus(target.identifier);
          } else {
            await refreshComposioConnectionStatus(target.identifier);
          }
        } catch {
          // Polling failure is expected until auth completes — suppress noise.
        }
      }, POLL_INTERVAL_MS);

      pollTimeoutRef.current = setTimeout(() => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setIsWaitingAuth(false);
      }, POLL_TIMEOUT_MS);
    },
    [checkLobehubStatus, refreshComposioConnectionStatus],
  );

  const startWindowMonitor = useCallback(
    (oauthWindow: Window, target: ConnectTarget) => {
      const stopMonitor = () => {
        if (windowCheckIntervalRef.current) {
          clearInterval(windowCheckIntervalRef.current);
          windowCheckIntervalRef.current = null;
        }
        if (windowCheckTimeoutRef.current) {
          clearTimeout(windowCheckTimeoutRef.current);
          windowCheckTimeoutRef.current = null;
        }
      };

      windowCheckIntervalRef.current = setInterval(async () => {
        try {
          if (!oauthWindow.closed) return;
          stopMonitor();
          oauthWindowRef.current = null;
          // Refresh status once right after the popup closes so multi-spec flows
          // can advance to the next provider immediately, instead of waiting up
          // to 15s for fallback polling to release isWaitingAuth.
          try {
            if (target.source === 'lobehub') {
              await checkLobehubStatus(target.identifier);
            } else {
              await refreshComposioConnectionStatus(target.identifier);
            }
          } catch {
            // Status check failure isn't actionable; release waiting state regardless.
          }
          setIsWaitingAuth(false);
        } catch {
          // COOP can block window.closed access — fall back to polling.
          stopMonitor();
          startFallbackPolling(target);
        }
      }, 500);

      windowCheckTimeoutRef.current = setTimeout(() => {
        stopMonitor();
        // Force-close the abandoned popup so a late completion doesn't fire a
        // postMessage we'd silently drop (oauthWindowRef.current was cleared).
        try {
          oauthWindowRef.current?.close();
        } catch {
          // Cross-origin restrictions may block .close(); ignore.
        }
        oauthWindowRef.current = null;
        setIsWaitingAuth(false);
      }, OAUTH_OVERALL_TIMEOUT_MS);
    },
    [checkLobehubStatus, refreshComposioConnectionStatus, startFallbackPolling],
  );

  const openOAuthWindow = useCallback(
    (url: string, target: ConnectTarget) => {
      cleanup();
      setIsWaitingAuth(true);

      const oauthWindow = window.open(url, '_blank', 'width=600,height=700');
      if (!oauthWindow) {
        // Popup blocked — abandon the flow so the caller can surface a clear
        // error instead of polling forever for an auth that never started.
        setIsWaitingAuth(false);
        throw new ConnectorConnectionPopupBlockedError();
      }
      oauthWindowRef.current = oauthWindow;
      startWindowMonitor(oauthWindow, target);
    },
    [cleanup, startWindowMonitor],
  );

  // Only LobeHub connector OAuth signals completion via postMessage; Composio relies on polling.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      // Reject same-origin iframes / other tabs forging the success event.
      if (event.source !== oauthWindowRef.current) return;
      if (event.data?.type !== LOBEHUB_SKILL_AUTH_SUCCESS_MESSAGE) return;
      const provider = event.data?.provider;
      if (!provider) return;
      cleanup();
      void checkLobehubStatus(provider);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [checkLobehubStatus, cleanup]);

  const connect = useCallback(async () => {
    if (isConnectingRef.current || isWaitingAuth) return;
    const next = nextUnconnected;
    if (!next) return;

    isConnectingRef.current = true;
    setIsConnecting(true);
    try {
      if (next.source === 'lobehub') {
        if (!isMarketAuthenticated) {
          try {
            await signInMarket('connector');
          } catch {
            // MarketAuthProvider already surfaces auth failures; task templates only need to stop this run.
          }
          throw new ConnectorConnectionMarketAuthRequiredError();
        }
        // Skip redirectUri on desktop (app:// protocol) since the system browser can't navigate to it
        const redirectUri = window.location.protocol.startsWith('http')
          ? `${window.location.origin}/oauth/callback/success?provider=${encodeURIComponent(next.identifier)}`
          : undefined;
        const { authorizeUrl } = await getLobehubAuth(next.identifier, { redirectUri });
        openOAuthWindow(authorizeUrl, next);
        return;
      }

      const userId = useUserStore.getState().user?.id;
      if (!userId) throw new Error('Sign-in required');
      const composioType = COMPOSIO_APP_TYPES.find((t) => t.identifier === next.identifier);
      if (!composioType) throw new Error(`Unknown Composio connector: ${next.identifier}`);
      const newServer = await createComposioConnection({
        appSlug: composioType.appSlug,
        identifier: next.identifier,
        label: composioType.label,
      });
      if (!newServer) throw new Error('Failed to create Composio server');
      if (newServer.status === ComposioServerStatus.ACTIVE) {
        await refreshComposioConnectionStatus(newServer.identifier);
      } else if (newServer.redirectUrl) {
        openOAuthWindow(newServer.redirectUrl, next);
      } else {
        throw new Error('Composio server is missing an OAuth URL');
      }
    } catch (error) {
      if (error instanceof ConnectorConnectionMarketAuthRequiredError) throw error;
      if (next.source === 'lobehub' && isMarketUnauthorizedError(error)) {
        throw new ConnectorConnectionMarketAuthRequiredError();
      }
      console.error('[useConnectorConnection] Failed to connect:', error);
      throw error;
    } finally {
      isConnectingRef.current = false;
      setIsConnecting(false);
    }
  }, [
    nextUnconnected,
    isWaitingAuth,
    isMarketAuthenticated,
    signInMarket,
    getLobehubAuth,
    createComposioConnection,
    refreshComposioConnectionStatus,
    openOAuthWindow,
  ]);

  return {
    connect,
    isAllConnected,
    isConnecting: isConnecting || isWaitingAuth,
    needsConnect,
    nextUnconnected,
  };
};
