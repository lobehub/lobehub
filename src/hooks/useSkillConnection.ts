'use client';

import type {
  LobehubSkillProviderType,
  TaskTemplateSkillRequirement,
  TaskTemplateSkillSource,
} from '@lobechat/const';
import {
  getKlavisServerByServerIdentifier,
  getLobehubSkillProviderById,
  KLAVIS_SERVER_TYPES,
} from '@lobechat/const';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LOBEHUB_SKILL_AUTH_SUCCESS_MESSAGE } from '@/const/skillConnection';
import { useToolStore } from '@/store/tool';
import { klavisStoreSelectors } from '@/store/tool/slices/klavisStore/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore/types';
import { lobehubSkillStoreSelectors } from '@/store/tool/slices/lobehubSkillStore/selectors';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';
import { useUserStore } from '@/store/user';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;
/** Hard cap on how long the OAuth popup-monitor keeps polling — protects against
 *  users opening the popup, switching away, and never closing it. */
const OAUTH_OVERALL_TIMEOUT_MS = 5 * 60 * 1000;

export interface SkillProviderMeta {
  icon: LobehubSkillProviderType['icon'];
  label: string;
  provider: string;
  source: TaskTemplateSkillSource;
}

type ConnectTarget = Pick<SkillProviderMeta, 'provider' | 'source'>;

export interface UseSkillConnectionResult {
  connect: () => Promise<void>;
  isAllConnected: boolean;
  isConnecting: boolean;
  /** True when there is at least one spec and at least one of them is not yet connected. */
  needsConnect: boolean;
  /** First spec in input order whose connection is missing. undefined when all connected or specs is empty. */
  nextUnconnected: SkillProviderMeta | undefined;
}

export const getProviderMeta = (
  spec: TaskTemplateSkillRequirement,
): SkillProviderMeta | undefined => {
  if (spec.source === 'lobehub') {
    const p = getLobehubSkillProviderById(spec.provider);
    if (!p) return undefined;
    return { icon: p.icon, label: p.label, provider: spec.provider, source: 'lobehub' };
  }
  const p = getKlavisServerByServerIdentifier(spec.provider);
  if (!p) return undefined;
  return { icon: p.icon, label: p.label, provider: spec.provider, source: 'klavis' };
};

export const findNextUnconnectedSpec = (
  specs: TaskTemplateSkillRequirement[] | undefined,
  isConnected: (spec: TaskTemplateSkillRequirement) => boolean,
): SkillProviderMeta | undefined => {
  if (!specs || specs.length === 0) return undefined;
  for (const spec of specs) {
    if (isConnected(spec)) continue;
    const meta = getProviderMeta(spec);
    if (!meta) continue;
    return meta;
  }
  return undefined;
};

export const useSkillConnection = (
  specs: TaskTemplateSkillRequirement[] | undefined,
): UseSkillConnectionResult => {
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
            await checkLobehubStatus(target.provider);
          } else {
            await refreshKlavisServerTools(target.provider);
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
    [checkLobehubStatus, refreshKlavisServerTools],
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

      windowCheckIntervalRef.current = setInterval(() => {
        try {
          if (oauthWindow.closed) {
            stopMonitor();
            oauthWindowRef.current = null;
            startFallbackPolling(target);
          }
        } catch {
          // COOP can block window.closed access — fall back to polling.
          stopMonitor();
          startFallbackPolling(target);
        }
      }, 500);

      windowCheckTimeoutRef.current = setTimeout(() => {
        stopMonitor();
        oauthWindowRef.current = null;
        setIsWaitingAuth(false);
      }, OAUTH_OVERALL_TIMEOUT_MS);
    },
    [startFallbackPolling],
  );

  const openOAuthWindow = useCallback(
    (url: string, target: ConnectTarget) => {
      cleanup();
      setIsWaitingAuth(true);

      const oauthWindow = window.open(url, '_blank', 'width=600,height=700');
      if (oauthWindow) {
        oauthWindowRef.current = oauthWindow;
        startWindowMonitor(oauthWindow, target);
      } else {
        startFallbackPolling(target);
      }
    },
    [cleanup, startWindowMonitor, startFallbackPolling],
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
        const redirectUri = `${window.location.origin}/oauth/callback/success?provider=${encodeURIComponent(
          next.provider,
        )}`;
        const { authorizeUrl } = await getLobehubAuth(next.provider, { redirectUri });
        openOAuthWindow(authorizeUrl, next);
        return;
      }

      const userId = useUserStore.getState().user?.id;
      if (!userId) return;
      const klavisType = KLAVIS_SERVER_TYPES.find((t) => t.identifier === next.provider);
      if (!klavisType) return;
      const newServer = await createKlavisServer({
        identifier: next.provider,
        serverName: klavisType.serverName,
        userId,
      });
      if (!newServer) return;
      if (newServer.isAuthenticated) {
        await refreshKlavisServerTools(newServer.identifier);
      } else if (newServer.oauthUrl) {
        openOAuthWindow(newServer.oauthUrl, next);
      }
    } catch (error) {
      console.error('[useSkillConnection] Failed to connect:', error);
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
  ]);

  return {
    connect,
    isAllConnected,
    isConnecting: isConnecting || isWaitingAuth,
    needsConnect,
    nextUnconnected,
  };
};
