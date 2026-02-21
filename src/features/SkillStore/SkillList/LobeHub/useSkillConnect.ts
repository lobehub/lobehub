'use client';

import { getLobehubSkillProviderById } from '@lobechat/const';
import { type Klavis } from 'klavis';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useToolStore } from '@/store/tool';
import { klavisStoreSelectors, lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;

interface UseSkillConnectOptions {
  identifier: string;
  serverName?: Klavis.McpServerName;
  type: 'klavis' | 'lobehub';
}

export const useSkillConnect = ({ identifier, serverName, type }: UseSkillConnectOptions) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isWaitingAuth, setIsWaitingAuth] = useState(false);

  const oauthWindowRef = useRef<Window | null>(null);
  const windowCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // LobeHub skill hooks
  const checkLobehubStatus = useToolStore((s) => s.checkLobehubSkillStatus);
  const revokeLobehubConnect = useToolStore((s) => s.revokeLobehubSkill);
  const getAuthorizeUrl = useToolStore((s) => s.getLobehubSkillAuthorizeUrl);
  const lobehubServer = useToolStore(lobehubSkillStoreSelectors.getServerByIdentifier(identifier));

  // Klavis hooks
  const userId = useUserStore(userProfileSelectors.userId);
  const createKlavisServer = useToolStore((s) => s.createKlavisServer);
  const refreshKlavisServerTools = useToolStore((s) => s.refreshKlavisServerTools);
  const removeKlavisServer = useToolStore((s) => s.removeKlavisServer);
  const klavisServer = useToolStore(klavisStoreSelectors.getServerByIdentifier(identifier));

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
    const connected =
      type === 'lobehub'
        ? lobehubServer?.status === LobehubSkillStatus.CONNECTED
        : klavisServer?.status === KlavisServerStatus.CONNECTED;

    if (connected && isWaitingAuth) {
      cleanup();
    }
  }, [type, lobehubServer?.status, klavisServer?.status, isWaitingAuth, cleanup]);

  // Listen for OAuth success message from popup window (for LobeHub skills)
  useEffect(() => {
    if (type !== 'lobehub') return;

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      if (
        event.data?.type === 'LOBEHUB_SKILL_AUTH_SUCCESS' &&
        event.data?.provider === identifier
      ) {
        cleanup();
        await checkLobehubStatus(identifier);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [type, identifier, cleanup, checkLobehubStatus]);

  const startFallbackPolling = useCallback(
    (serverIdOrName: string) => {
      if (pollIntervalRef.current) return;

      pollIntervalRef.current = setInterval(async () => {
        try {
          if (type === 'lobehub') {
            await checkLobehubStatus(serverIdOrName);
          } else {
            await refreshKlavisServerTools(serverIdOrName);
          }
        } catch (error) {
          console.error('[SkillStore] Failed to check status:', error);
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
    [type, checkLobehubStatus, refreshKlavisServerTools],
  );

  const startWindowMonitor = useCallback(
    (oauthWindow: Window, serverIdOrName: string) => {
      windowCheckIntervalRef.current = setInterval(async () => {
        try {
          if (oauthWindow.closed) {
            if (windowCheckIntervalRef.current) {
              clearInterval(windowCheckIntervalRef.current);
              windowCheckIntervalRef.current = null;
            }
            oauthWindowRef.current = null;
            // Check status and then reset waiting state
            if (type === 'lobehub') {
              await checkLobehubStatus(serverIdOrName);
            } else {
              await refreshKlavisServerTools(serverIdOrName);
            }
            setIsWaitingAuth(false);
          }
        } catch {
          if (windowCheckIntervalRef.current) {
            clearInterval(windowCheckIntervalRef.current);
            windowCheckIntervalRef.current = null;
          }
          startFallbackPolling(serverIdOrName);
        }
      }, 500);
    },
    [type, checkLobehubStatus, refreshKlavisServerTools, startFallbackPolling],
  );

  const openOAuthWindow = useCallback(
    (oauthUrl: string, serverIdOrName: string) => {
      cleanup();
      setIsWaitingAuth(true);

      const oauthWindow = window.open(oauthUrl, '_blank', 'width=600,height=700');
      if (oauthWindow) {
        oauthWindowRef.current = oauthWindow;
        startWindowMonitor(oauthWindow, serverIdOrName);
      } else {
        startFallbackPolling(serverIdOrName);
      }
    },
    [cleanup, startWindowMonitor, startFallbackPolling],
  );

  // Handle connect for LobeHub
  const handleLobehubConnect = useCallback(async () => {
    if (lobehubServer?.isConnected) return;

    setIsConnecting(true);
    try {
      const provider = getLobehubSkillProviderById(identifier);
      if (!provider) return;

      const redirectUri = `${window.location.origin}/oauth/callback/success?provider=${encodeURIComponent(identifier)}`;
      const { authorizeUrl } = await getAuthorizeUrl(identifier, { redirectUri });
      openOAuthWindow(authorizeUrl, identifier);
    } catch (error) {
      console.error('[SkillStore] Failed to get authorize URL:', error);
    } finally {
      setIsConnecting(false);
    }
  }, [identifier, lobehubServer?.isConnected, getAuthorizeUrl, openOAuthWindow]);

  // Handle connect for Klavis
  const handleKlavisConnect = useCallback(async () => {
    if (!userId || !serverName) return;
    if (klavisServer) return;

    setIsConnecting(true);
    try {
      const newServer = await createKlavisServer({
        identifier,
        serverName,
        userId,
      });

      if (newServer) {
        if (newServer.isAuthenticated) {
          await refreshKlavisServerTools(newServer.identifier);
        } else if (newServer.oauthUrl) {
          openOAuthWindow(newServer.oauthUrl, newServer.identifier);
        }
      }
    } catch (error) {
      console.error('[SkillStore] Failed to connect server:', error);
    } finally {
      setIsConnecting(false);
    }
  }, [
    userId,
    serverName,
    klavisServer,
    identifier,
    createKlavisServer,
    refreshKlavisServerTools,
    openOAuthWindow,
  ]);

  const handleConnect = type === 'lobehub' ? handleLobehubConnect : handleKlavisConnect;

  const handleDisconnect = useCallback(async () => {
    if (type === 'lobehub' && lobehubServer) {
      await revokeLobehubConnect(lobehubServer.identifier);
    } else if (type === 'klavis' && klavisServer) {
      await removeKlavisServer(klavisServer.identifier);
    }
  }, [type, lobehubServer, klavisServer, revokeLobehubConnect, removeKlavisServer]);

  const isConnected =
    type === 'lobehub'
      ? lobehubServer?.status === LobehubSkillStatus.CONNECTED
      : klavisServer?.status === KlavisServerStatus.CONNECTED;

  return {
    handleConnect,
    handleDisconnect,
    isConnected,
    isConnecting: isConnecting || isWaitingAuth,
  };
};
