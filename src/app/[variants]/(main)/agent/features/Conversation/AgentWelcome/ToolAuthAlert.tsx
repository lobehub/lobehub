'use client';

import { type KlavisServerType } from '@lobechat/const';
import { KLAVIS_SERVER_TYPES } from '@lobechat/const';
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
import { type KlavisServer } from '@/store/tool/slices/klavisStore';
import { KlavisServerStatus, klavisStoreSelectors } from '@/store/tool/slices/klavisStore';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

// Tools that require Market authentication
const MARKET_AUTH_TOOLS = [
  {
    avatar: '💻',
    identifier: 'lobe-cloud-sandbox',
    label: 'Cloud Sandbox',
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
          console.debug('[Klavis] Polling check (expected during auth):', error);
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
            // Start polling after window closes
            startFallbackPolling(identifier);
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
      horizontal
      align="center"
      gap={12}
      justify="space-between"
      style={{
        cursor: 'pointer',
      }}
      onClick={handleAuthorize}
    >
      <Flexbox horizontal align="center" gap={8}>
        {renderIcon()}
        <Text>{tool.label}</Text>
      </Flexbox>
      <Button
        disabled={isLoading}
        icon={PlusIcon}
        loading={isLoading}
        size="small"
        type="text"
        onClick={handleAuthorize}
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
      horizontal
      align="center"
      gap={12}
      justify="space-between"
      style={{
        cursor: 'pointer',
      }}
      onClick={handleSignIn}
    >
      <Flexbox horizontal align="center" gap={8}>
        <Avatar alt={tool.label} avatar={tool.avatar} size={20} style={{ flex: 'none' }} />
        <Text>{tool.label}</Text>
      </Flexbox>
      <Button
        disabled={isLoading}
        icon={PlusIcon}
        loading={isLoading}
        size="small"
        type="text"
        onClick={handleSignIn}
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
      showIcon={false}
      style={{ width: '100%' }}
      type="secondary"
      description={
        <>
          {t('toolAuth.hint')}
          <Divider dashed style={{ marginBlock: 12 }} />
          <Flexbox gap={12} style={{ marginTop: 8 }}>
            {pendingAuthTools.map((tool) =>
              tool.authType === 'klavis' ? (
                <KlavisToolAuthItem
                  key={tool.identifier}
                  tool={tool}
                  onAuthComplete={() => {
                    // Component will re-render and tool will be removed from list
                  }}
                />
              ) : (
                <MarketToolAuthItem key={tool.identifier} tool={tool} />
              ),
            )}
          </Flexbox>
        </>
      }
      title={
        <Flexbox horizontal align="center" gap={6}>
          {t('toolAuth.title')}
        </Flexbox>
      }
    />
  );
});

ToolAuthAlert.displayName = 'ToolAuthAlert';

export default ToolAuthAlert;
