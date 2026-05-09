import type { TaskTemplateSkillRequirement } from '@lobechat/const';
import { KLAVIS_SERVER_TYPES } from '@lobechat/const';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LOBEHUB_SKILL_AUTH_SUCCESS_MESSAGE } from '@/const/skillConnection';
import { useToolStore } from '@/store/tool';
import { klavisStoreSelectors } from '@/store/tool/slices/klavisStore/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore/types';
import { lobehubSkillStoreSelectors } from '@/store/tool/slices/lobehubSkillStore/selectors';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';
import { useUserStore } from '@/store/user';

import type { SkillProviderMeta } from './providerMeta';
import { findNextUnconnectedSpec } from './providerMeta';

// Re-exported for callers that prefer a single import surface for the hook +
// its types/helpers. The pure helpers themselves live in `./providerMeta` so
// unit tests can import them without dragging in the store-dependency graph.
export type { SkillProviderMeta } from './providerMeta';
export { findNextUnconnectedSpec, getProviderMeta } from './providerMeta';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;
/** Hard cap on how long the OAuth popup-monitor keeps polling — protects against
 *  users opening the popup, switching away, and never closing it. */
const OAUTH_OVERALL_TIMEOUT_MS = 5 * 60 * 1000;

/** Thrown when the browser blocks the OAuth popup so callers can surface a clear hint. */
export class SkillConnectionPopupBlockedError extends Error {
  constructor() {
    super('Browser popup blocked');
    this.name = 'SkillConnectionPopupBlockedError';
  }
}

type ConnectTarget = Pick<SkillProviderMeta, 'provider' | 'source'>;

export type SkillConnectionResultStatus =
  | 'cancel'
  | 'fail'
  | 'popup_blocked'
  | 'success'
  | 'timeout';

export interface SkillConnectionResult {
  durationMs: number;
  provider: string;
  result: SkillConnectionResultStatus;
  source: ConnectTarget['source'];
}

export interface UseSkillConnectionOptions {
  onConnectResult?: (result: SkillConnectionResult) => void;
}

export interface UseSkillConnectionResult {
  connect: () => Promise<void>;
  isAllConnected: boolean;
  isConnecting: boolean;
  /** True when there is at least one spec and at least one of them is not yet connected. */
  needsConnect: boolean;
  /** First spec in input order whose connection is missing. undefined when all connected or specs is empty. */
  nextUnconnected: SkillProviderMeta | undefined;
}

export const useSkillConnection = (
  specs: TaskTemplateSkillRequirement[] | undefined,
  options: UseSkillConnectionOptions = {},
): UseSkillConnectionResult => {
  const { onConnectResult } = options;
  const getLobehubAuth = useToolStore((s) => s.getLobehubSkillAuthorizeUrl);
  const checkLobehubStatus = useToolStore((s) => s.checkLobehubSkillStatus);
  const createKlavisServer = useToolStore((s) => s.createKlavisServer);
  const refreshKlavisServerTools = useToolStore((s) => s.refreshKlavisServerTools);

  const lobehubServers = useToolStore(lobehubSkillStoreSelectors.getServers);
  const klavisServers = useToolStore(klavisStoreSelectors.getServers);

  const isConnectedFor = useCallback(
    (spec: TaskTemplateSkillRequirement): boolean => {
      if (spec.source === 'lobehub') {
        return lobehubServers.some(
          (s) => s.identifier === spec.provider && s.status === LobehubSkillStatus.CONNECTED,
        );
      }
      return klavisServers.some(
        (s) => s.identifier === spec.provider && s.status === KlavisServerStatus.CONNECTED,
      );
    },
    [lobehubServers, klavisServers],
  );

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
  const activeConnectionRef = useRef<
    | {
        resultReported: boolean;
        startedAt: number;
        target: ConnectTarget;
      }
    | undefined
  >(undefined);

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

  const reportConnectResult = useCallback(
    (result: SkillConnectionResultStatus, target?: ConnectTarget) => {
      const activeConnection = activeConnectionRef.current;
      const resolvedTarget = target ?? activeConnection?.target;

      if (!activeConnection || !resolvedTarget || activeConnection.resultReported) return;

      activeConnectionRef.current = {
        ...activeConnection,
        resultReported: true,
      };
      onConnectResult?.({
        durationMs: Date.now() - activeConnection.startedAt,
        provider: resolvedTarget.provider,
        result,
        source: resolvedTarget.source,
      });
    },
    [onConnectResult],
  );

  const finishConnection = useCallback(
    (result: SkillConnectionResultStatus, target?: ConnectTarget) => {
      reportConnectResult(result, target);
      cleanup();
    },
    [cleanup, reportConnectResult],
  );

  const isTargetConnected = useCallback((target: ConnectTarget): boolean => {
    const state = useToolStore.getState();

    if (target.source === 'lobehub') {
      return state.lobehubSkillServers.some(
        (server) =>
          server.identifier === target.provider && server.status === LobehubSkillStatus.CONNECTED,
      );
    }

    return state.servers.some(
      (server) =>
        server.identifier === target.provider && server.status === KlavisServerStatus.CONNECTED,
    );
  }, []);

  const refreshTargetStatus = useCallback(
    async (target: ConnectTarget): Promise<boolean> => {
      if (target.source === 'lobehub') {
        const server = await checkLobehubStatus(target.provider);
        return server?.status === LobehubSkillStatus.CONNECTED;
      }

      await refreshKlavisServerTools(target.provider);
      return isTargetConnected(target);
    },
    [checkLobehubStatus, isTargetConnected, refreshKlavisServerTools],
  );

  useEffect(() => () => cleanup(), [cleanup]);

  useEffect(() => {
    if (!isWaitingAuth || nextUnconnected) return;
    finishConnection('success');
  }, [finishConnection, isWaitingAuth, nextUnconnected]);

  const startFallbackPolling = useCallback(
    (target: ConnectTarget) => {
      if (pollIntervalRef.current) return;

      pollIntervalRef.current = setInterval(async () => {
        try {
          const connected = await refreshTargetStatus(target);
          if (connected) finishConnection('success', target);
        } catch (error) {
          // Polling failure is expected until auth completes, but keep it visible
          // in local debugging because it can otherwise mask a broken OAuth route.
          console.error('[useSkillConnection] Failed to poll auth status:', error);
        }
      }, POLL_INTERVAL_MS);

      pollTimeoutRef.current = setTimeout(() => {
        finishConnection('timeout', target);
      }, POLL_TIMEOUT_MS);
    },
    [finishConnection, refreshTargetStatus],
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
          const connected = await refreshTargetStatus(target).catch((error) => {
            console.error('[useSkillConnection] Failed to refresh auth status:', error);
            return false;
          });
          finishConnection(connected ? 'success' : 'cancel', target);
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
        finishConnection('timeout', target);
      }, OAUTH_OVERALL_TIMEOUT_MS);
    },
    [finishConnection, refreshTargetStatus, startFallbackPolling],
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
        reportConnectResult('popup_blocked', target);
        throw new SkillConnectionPopupBlockedError();
      }
      oauthWindowRef.current = oauthWindow;
      startWindowMonitor(oauthWindow, target);
    },
    [cleanup, reportConnectResult, startWindowMonitor],
  );

  // Only LobeHub Skill OAuth signals completion via postMessage; Klavis relies on polling.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      // Reject same-origin iframes / other tabs forging the success event.
      if (event.source !== oauthWindowRef.current) return;
      if (event.data?.type !== LOBEHUB_SKILL_AUTH_SUCCESS_MESSAGE) return;
      const provider = event.data?.provider;
      if (!provider) return;
      void checkLobehubStatus(provider).then((server) => {
        finishConnection(server?.status === LobehubSkillStatus.CONNECTED ? 'success' : 'fail', {
          provider,
          source: 'lobehub',
        });
      });
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [checkLobehubStatus, finishConnection]);

  const connect = useCallback(async () => {
    if (isConnectingRef.current || isWaitingAuth) return;
    const next = nextUnconnected;
    if (!next) return;

    isConnectingRef.current = true;
    activeConnectionRef.current = {
      resultReported: false,
      startedAt: Date.now(),
      target: next,
    };
    setIsConnecting(true);
    try {
      if (next.source === 'lobehub') {
        // Skip redirectUri on desktop (app:// protocol) since the system browser can't navigate to it
        const redirectUri = window.location.protocol.startsWith('http')
          ? `${window.location.origin}/oauth/callback/success?provider=${encodeURIComponent(next.provider)}`
          : undefined;
        const { authorizeUrl } = await getLobehubAuth(next.provider, { redirectUri });
        openOAuthWindow(authorizeUrl, next);
        return;
      }

      const userId = useUserStore.getState().user?.id;
      if (!userId) throw new Error('Sign-in required');
      const klavisType = KLAVIS_SERVER_TYPES.find((t) => t.identifier === next.provider);
      if (!klavisType) throw new Error(`Unknown Klavis provider: ${next.provider}`);
      const newServer = await createKlavisServer({
        identifier: next.provider,
        serverName: klavisType.serverName,
        userId,
      });
      if (!newServer) throw new Error('Failed to create Klavis server');
      if (newServer.isAuthenticated) {
        await refreshKlavisServerTools(newServer.identifier);
        reportConnectResult(isTargetConnected(next) ? 'success' : 'fail', next);
      } else if (newServer.oauthUrl) {
        openOAuthWindow(newServer.oauthUrl, next);
      } else {
        throw new Error('Klavis server is missing an OAuth URL');
      }
    } catch (error) {
      console.error('[useSkillConnection] Failed to connect:', error);
      if (error instanceof SkillConnectionPopupBlockedError) {
        reportConnectResult('popup_blocked', next);
      } else {
        reportConnectResult('fail', next);
      }
      throw error;
    } finally {
      isConnectingRef.current = false;
      setIsConnecting(false);
    }
  }, [
    nextUnconnected,
    isWaitingAuth,
    getLobehubAuth,
    createKlavisServer,
    refreshKlavisServerTools,
    openOAuthWindow,
    isTargetConnected,
    reportConnectResult,
  ]);

  return {
    connect,
    isAllConnected,
    isConnecting: isConnecting || isWaitingAuth,
    needsConnect,
    nextUnconnected,
  };
};
