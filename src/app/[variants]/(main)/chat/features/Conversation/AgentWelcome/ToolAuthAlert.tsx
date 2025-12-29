'use client';

import { KLAVIS_SERVER_TYPES, type KlavisServerType } from '@lobechat/const';
import { Alert, Avatar, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { PlusIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import {
  type KlavisServer,
  KlavisServerStatus,
  klavisStoreSelectors,
} from '@/store/tool/slices/klavisStore';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

// Tools that require Market authentication
const MARKET_AUTH_TOOLS = [
  {
    avatar:
      'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz48IS0tIFVwbG9hZGVkIHRvOiBTVkcgUmVwbywgd3d3LnN2Z3JlcG8uY29tLCBHZW5lcmF0b3I6IFNWRyBSZXBvIE1peGVyIFRvb2xzIC0tPgo8c3ZnIHdpZHRoPSI4MDBweCIgaGVpZ2h0PSI4MDBweCIgdmlld0JveD0iMCAwIDMyIDMyIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPg0KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xMy4wMTY0IDJDMTAuODE5MyAyIDkuMDM4MjUgMy43MjQ1MyA5LjAzODI1IDUuODUxODVWOC41MTg1MkgxNS45MjM1VjkuMjU5MjZINS45NzgxNEMzLjc4MTA3IDkuMjU5MjYgMiAxMC45ODM4IDIgMTMuMTExMUwyIDE4Ljg4ODlDMiAyMS4wMTYyIDMuNzgxMDcgMjIuNzQwNyA1Ljk3ODE0IDIyLjc0MDdIOC4yNzMyMlYxOS40ODE1QzguMjczMjIgMTcuMzU0MiAxMC4wNTQzIDE1LjYyOTYgMTIuMjUxNCAxNS42Mjk2SDE5LjU5NTZDMjEuNDU0NyAxNS42Mjk2IDIyLjk2MTcgMTQuMTcwNCAyMi45NjE3IDEyLjM3MDRWNS44NTE4NUMyMi45NjE3IDMuNzI0NTMgMjEuMTgwNyAyIDE4Ljk4MzYgMkgxMy4wMTY0Wk0xMi4wOTg0IDYuNzQwNzRDMTIuODU4OSA2Ljc0MDc0IDEzLjQ3NTQgNi4xNDM3OCAxMy40NzU0IDUuNDA3NDFDMTMuNDc1NCA0LjY3MTAzIDEyLjg1ODkgNC4wNzQwNyAxMi4wOTg0IDQuMDc0MDdDMTEuMzM3OCA0LjA3NDA3IDEwLjcyMTMgNC42NzEwMyAxMC43MjEzIDUuNDA3NDFDMTAuNzIxMyA2LjE0Mzc4IDExLjMzNzggNi43NDA3NCAxMi4wOTg0IDYuNzQwNzRaIiBmaWxsPSJ1cmwoI3BhaW50MF9saW5lYXJfODdfODIwNCkiLz4NCjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMTguOTgzNCAzMEMyMS4xODA1IDMwIDIyLjk2MTYgMjguMjc1NSAyMi45NjE2IDI2LjE0ODJWMjMuNDgxNUwxNi4wNzYzIDIzLjQ4MTVMMTYuMDc2MyAyMi43NDA4TDI2LjAyMTcgMjIuNzQwOEMyOC4yMTg4IDIyLjc0MDggMjkuOTk5OCAyMS4wMTYyIDI5Ljk5OTggMTguODg4OVYxMy4xMTExQzI5Ljk5OTggMTAuOTgzOCAyOC4yMTg4IDkuMjU5MjggMjYuMDIxNyA5LjI1OTI4TDIzLjcyNjYgOS4yNTkyOFYxMi41MTg1QzIzLjcyNjYgMTQuNjQ1OSAyMS45NDU1IDE2LjM3MDQgMTkuNzQ4NSAxNi4zNzA0TDEyLjQwNDIgMTYuMzcwNEMxMC41NDUxIDE2LjM3MDQgOS4wMzgwOSAxNy44Mjk2IDkuMDM4MDkgMTkuNjI5Nkw5LjAzODA5IDI2LjE0ODJDOS4wMzgwOSAyOC4yNzU1IDEwLjgxOTIgMzAgMTMuMDE2MiAzMEgxOC45ODM0Wk0xOS45MDE1IDI1LjI1OTNDMTkuMTQwOSAyNS4yNTkzIDE4LjUyNDQgMjUuODU2MiAxOC41MjQ0IDI2LjU5MjZDMTguNTI0NCAyNy4zMjkgMTkuMTQwOSAyNy45MjU5IDE5LjkwMTUgMjcuOTI1OUMyMC42NjIgMjcuOTI1OSAyMS4yNzg1IDI3LjMyOSAyMS4yNzg1IDI2LjU5MjZDMjEuMjc4NSAyNS44NTYyIDIwLjY2MiAyNS4yNTkzIDE5LjkwMTUgMjUuMjU5M1oiIGZpbGw9InVybCgjcGFpbnQxX2xpbmVhcl84N184MjA0KSIvPg0KPGRlZnM+DQo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MF9saW5lYXJfODdfODIwNCIgeDE9IjEyLjQ4MDkiIHkxPSIyIiB4Mj0iMTIuNDgwOSIgeTI9IjIyLjc0MDciIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4NCjxzdG9wIHN0b3AtY29sb3I9IiMzMjdFQkQiLz4NCjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzE1NjVBNyIvPg0KPC9saW5lYXJHcmFkaWVudD4NCjxsaW5lYXJHcmFkaWVudCBpZD0icGFpbnQxX2xpbmVhcl84N184MjA0IiB4MT0iMTkuNTE5IiB5MT0iOS4yNTkyOCIgeDI9IjE5LjUxOSIgeTI9IjMwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+DQo8c3RvcCBzdG9wLWNvbG9yPSIjRkZEQTRCIi8+DQo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNGOUM2MDAiLz4NCjwvbGluZWFyR3JhZGllbnQ+DQo8L2RlZnM+DQo8L3N2Zz4=',
    identifier: 'lobe-cloud-code-interpreter',
    label: 'Cloud Code Interpreter',
  },
];

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;

interface PendingKlavisTool extends KlavisServerType {
  authType: 'klavis';
  server?: KlavisServer;
}

interface PendingMarketTool {
  authType: 'market';
  avatar: string;
  identifier: string;
  label: string;
}

type PendingAuthTool = PendingKlavisTool | PendingMarketTool;

interface KlavisToolAuthItemProps {
  onAuthComplete: () => void;
  tool: PendingKlavisTool;
}

const KlavisToolAuthItem = memo<KlavisToolAuthItemProps>(({ tool, onAuthComplete }) => {
  const { t } = useTranslation('chat');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isWaitingAuth, setIsWaitingAuth] = useState(false);

  const oauthWindowRef = useRef<Window | null>(null);
  const windowCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userId = useUserStore(userProfileSelectors.userId);
  const createKlavisServer = useToolStore((s) => s.createKlavisServer);
  const refreshKlavisServerTools = useToolStore((s) => s.refreshKlavisServerTools);

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
    if (tool.server?.status === KlavisServerStatus.CONNECTED && isWaitingAuth) {
      cleanup();
      onAuthComplete();
    }
  }, [tool.server?.status, isWaitingAuth, cleanup, onAuthComplete]);

  const startFallbackPolling = useCallback(
    (identifier: string) => {
      if (pollIntervalRef.current) return;

      pollIntervalRef.current = setInterval(async () => {
        try {
          await refreshKlavisServerTools(identifier);
        } catch (error) {
          console.error('[Klavis] Failed to check auth status:', error);
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
    [refreshKlavisServerTools],
  );

  const startWindowMonitor = useCallback(
    (oauthWindow: Window, identifier: string) => {
      windowCheckIntervalRef.current = setInterval(() => {
        try {
          if (oauthWindow.closed) {
            if (windowCheckIntervalRef.current) {
              clearInterval(windowCheckIntervalRef.current);
              windowCheckIntervalRef.current = null;
            }
            oauthWindowRef.current = null;
            refreshKlavisServerTools(identifier);
          }
        } catch {
          if (windowCheckIntervalRef.current) {
            clearInterval(windowCheckIntervalRef.current);
            windowCheckIntervalRef.current = null;
          }
          startFallbackPolling(identifier);
        }
      }, 500);
    },
    [refreshKlavisServerTools, startFallbackPolling],
  );

  const openOAuthWindow = useCallback(
    (oauthUrl: string, identifier: string) => {
      cleanup();
      setIsWaitingAuth(true);

      const oauthWindow = window.open(oauthUrl, '_blank', 'width=600,height=700');
      if (oauthWindow) {
        oauthWindowRef.current = oauthWindow;
        startWindowMonitor(oauthWindow, identifier);
      } else {
        startFallbackPolling(identifier);
      }
    },
    [cleanup, startWindowMonitor, startFallbackPolling],
  );

  const handleAuthorize = async () => {
    if (!userId) return;

    if (tool.server?.status === KlavisServerStatus.PENDING_AUTH && tool.server.oauthUrl) {
      openOAuthWindow(tool.server.oauthUrl, tool.server.identifier);
      return;
    }

    setIsConnecting(true);
    try {
      const newServer = await createKlavisServer({
        identifier: tool.identifier,
        serverName: tool.serverName,
        userId,
      });

      if (newServer) {
        if (newServer.isAuthenticated) {
          await refreshKlavisServerTools(newServer.identifier);
          onAuthComplete();
        } else if (newServer.oauthUrl) {
          openOAuthWindow(newServer.oauthUrl, newServer.identifier);
        }
      }
    } catch (error) {
      console.error('[ToolAuthAlert] Failed to create server:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  const renderIcon = () => {
    if (typeof tool.icon === 'string') {
      return <Avatar alt={tool.label} avatar={tool.icon} size={20} style={{ flex: 'none' }} />;
    }
    return <Icon fill={cssVar.colorText} icon={tool.icon} size={20} />;
  };

  const isLoading = isConnecting || isWaitingAuth;

  return (
    <Flexbox
      align="center"
      gap={12}
      horizontal
      justify="space-between"
      onClick={handleAuthorize}
      style={{
        cursor: 'pointer',
      }}
    >
      <Flexbox align="center" gap={8} horizontal>
        {renderIcon()}
        <Text>{tool.label}</Text>
      </Flexbox>
      <Button
        disabled={isLoading}
        icon={PlusIcon}
        loading={isLoading}
        onClick={handleAuthorize}
        size="small"
        type="text"
      >
        {isLoading ? t('toolAuth.authorizing') : t('toolAuth.authorize')}
      </Button>
    </Flexbox>
  );
});

KlavisToolAuthItem.displayName = 'KlavisToolAuthItem';

interface MarketToolAuthItemProps {
  tool: PendingMarketTool;
}

const MarketToolAuthItem = memo<MarketToolAuthItemProps>(({ tool }) => {
  const { t } = useTranslation('chat');
  const { signIn, isLoading } = useMarketAuth();

  const handleSignIn = async () => {
    try {
      await signIn();
    } catch (error) {
      console.error('[ToolAuthAlert] Market sign in failed:', error);
    }
  };

  return (
    <Flexbox
      align="center"
      gap={12}
      horizontal
      justify="space-between"
      onClick={handleSignIn}
      style={{
        cursor: 'pointer',
      }}
    >
      <Flexbox align="center" gap={8} horizontal>
        <Avatar alt={tool.label} avatar={tool.avatar} size={20} style={{ flex: 'none' }} />
        <Text>{tool.label}</Text>
      </Flexbox>
      <Button
        disabled={isLoading}
        icon={PlusIcon}
        loading={isLoading}
        onClick={handleSignIn}
        size="small"
        type="text"
      >
        {isLoading ? t('toolAuth.authorizing') : t('toolAuth.signIn')}
      </Button>
    </Flexbox>
  );
});

MarketToolAuthItem.displayName = 'MarketToolAuthItem';

const ToolAuthAlert = memo(() => {
  const { t } = useTranslation('chat');

  const plugins = useAgentStore(agentSelectors.currentAgentPlugins, isEqual);
  const klavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);
  const { isAuthenticated: isMarketAuthenticated } = useMarketAuth();

  // Filter out tools that need authorization
  const pendingAuthTools = useMemo<PendingAuthTool[]>(() => {
    const result: PendingAuthTool[] = [];

    for (const pluginId of plugins) {
      // Check if this is a Klavis tool
      const klavisType = KLAVIS_SERVER_TYPES.find((t) => t.identifier === pluginId);
      if (klavisType) {
        const server = klavisServers.find((s) => s.identifier === pluginId);
        // Not installed or pending auth
        if (!server || server.status === KlavisServerStatus.PENDING_AUTH) {
          result.push({ ...klavisType, authType: 'klavis', server });
        }
        continue;
      }

      // Check if this is a Market auth tool
      const marketTool = MARKET_AUTH_TOOLS.find((t) => t.identifier === pluginId);
      if (marketTool && !isMarketAuthenticated) {
        result.push({ ...marketTool, authType: 'market' });
      }
    }

    return result;
  }, [plugins, klavisServers, isMarketAuthenticated]);

  // Don't render if no pending auth tools
  if (pendingAuthTools.length === 0) {
    return null;
  }

  return (
    <Alert
      description={
        <>
          {t('toolAuth.hint')}
          <Divider dashed style={{ marginBlock: 12 }} />
          <Flexbox gap={12} style={{ marginTop: 8 }}>
            {pendingAuthTools.map((tool) =>
              tool.authType === 'klavis' ? (
                <KlavisToolAuthItem
                  key={tool.identifier}
                  onAuthComplete={() => {
                    // Component will re-render and tool will be removed from list
                  }}
                  tool={tool}
                />
              ) : (
                <MarketToolAuthItem key={tool.identifier} tool={tool} />
              ),
            )}
          </Flexbox>
        </>
      }
      showIcon={false}
      style={{ width: '100%' }}
      title={
        <Flexbox align="center" gap={6} horizontal>
          {t('toolAuth.title')}
        </Flexbox>
      }
      type="secondary"
    />
  );
});

ToolAuthAlert.displayName = 'ToolAuthAlert';

export default ToolAuthAlert;
