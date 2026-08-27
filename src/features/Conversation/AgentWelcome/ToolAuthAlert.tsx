'use client';

import type { TaskTemplateConnectorReference } from '@lobechat/const';
import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Alert, Avatar, Button, Text, toast } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { PlusIcon, XIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { contextSelectors, useConversationStore } from '@/features/Conversation/store';
import {
  ConnectorConnectionMarketAuthRequiredError,
  ConnectorConnectionPopupBlockedError,
  useConnectorConnection,
} from '@/features/RecommendTaskTemplates/useConnectorConnection';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { ComposioServerStatus, composioStoreSelectors } from '@/store/tool/slices/composioStore';
import { lobehubSkillStoreSelectors } from '@/store/tool/slices/lobehubSkillStore/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import type {
  PendingComposioTool,
  PendingLobehubTool,
  PendingMarketTool,
} from './resolvePendingAuthTools';
import { resolvePendingAuthTools } from './resolvePendingAuthTools';

const styles = createStaticStyles(({ css }) => ({
  // Reveal the remove icon only when the row is hovered.
  row: css`
    &:hover .tool-auth-remove {
      opacity: 1;
    }
  `,
  removeIcon: css`
    opacity: 0;
    transition: opacity 0.2s ease;
  `,
}));

// Tools that require Market authentication
const MARKET_AUTH_TOOLS = [
  {
    authType: 'market',
    avatar: '💻',
    identifier: 'lobe-cloud-sandbox',
    label: 'Cloud Sandbox',
  },
] satisfies PendingMarketTool[];

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;

interface ComposioToolAuthItemProps {
  onAuthComplete: () => void;
  tool: PendingComposioTool;
}

const ComposioToolAuthItem = memo<ComposioToolAuthItemProps>(({ tool, onAuthComplete }) => {
  const { t } = useTranslation('chat');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isWaitingAuth, setIsWaitingAuth] = useState(false);

  const oauthWindowRef = useRef<Window | null>(null);
  const windowCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userId = useUserStore(userProfileSelectors.userId);
  const createComposioConnection = useToolStore((s) => s.createComposioConnection);
  const refreshComposioConnectionStatus = useToolStore((s) => s.refreshComposioConnectionStatus);
  const removeComposioConnection = useToolStore((s) => s.removeComposioConnection);
  const removePlugin = useAgentStore((s) => s.removePlugin);

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
    if (tool.server?.status === ComposioServerStatus.ACTIVE && isWaitingAuth) {
      cleanup();
      onAuthComplete();
    }
  }, [tool.server?.status, isWaitingAuth, cleanup, onAuthComplete]);

  const startFallbackPolling = useCallback(
    (identifier: string) => {
      if (pollIntervalRef.current) return;

      pollIntervalRef.current = setInterval(async () => {
        try {
          await refreshComposioConnectionStatus(identifier);
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
      }, POLL_TIMEOUT_MS);
    },
    [refreshComposioConnectionStatus],
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
    [startFallbackPolling],
  );

  const openOAuthWindow = useCallback(
    (redirectUrl: string, identifier: string) => {
      cleanup();
      setIsWaitingAuth(true);

      const oauthWindow = window.open(redirectUrl, '_blank', 'width=600,height=700');
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

    if (tool.server?.status === ComposioServerStatus.PENDING_AUTH && tool.server.redirectUrl) {
      openOAuthWindow(tool.server.redirectUrl, tool.server.identifier);
      return;
    }

    setIsConnecting(true);
    try {
      const newServer = await createComposioConnection({
        appSlug: tool.appSlug,
        identifier: tool.identifier,
        label: tool.label,
      });

      if (newServer) {
        if (newServer.status === ComposioServerStatus.ACTIVE) {
          await refreshComposioConnectionStatus(newServer.identifier);
          onAuthComplete();
        } else if (newServer.redirectUrl) {
          openOAuthWindow(newServer.redirectUrl, newServer.identifier);
        }
      }
    } catch (error) {
      console.error('[ToolAuthAlert] Failed to create server:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  // Remove this connector from the agent. It's not authorized yet, so also drop
  // any pending connection (best-effort) so a later reconnect starts clean.
  const handleRemove = async () => {
    if (tool.server) await removeComposioConnection(tool.server.identifier);
    try {
      await removePlugin(tool.identifier);
    } catch (error) {
      console.error('[ToolAuthAlert] Failed to remove plugin:', error);
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
      className={cx(styles.row)}
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
        <ActionIcon
          className={cx('tool-auth-remove', styles.removeIcon)}
          icon={XIcon}
          size="small"
          title={t('toolAuth.remove')}
          onClick={(e) => {
            e.stopPropagation();
            handleRemove();
          }}
        />
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

ComposioToolAuthItem.displayName = 'ComposioToolAuthItem';

interface LobehubToolAuthItemProps {
  tool: PendingLobehubTool;
}

const LobehubToolAuthItem = ({ tool }: LobehubToolAuthItemProps) => {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const removePlugin = useAgentStore((state) => state.removePlugin);
  const connectorSpecs = useMemo<TaskTemplateConnectorReference[]>(
    () => [{ identifier: tool.id, source: 'lobehub' }],
    [tool.id],
  );
  const { connect, isConnecting } = useConnectorConnection(connectorSpecs);

  const handleAuthorize = async () => {
    try {
      await connect();
    } catch (error) {
      // MarketAuthProvider already surfaces this interruption; avoid a duplicate toast.
      if (error instanceof ConnectorConnectionMarketAuthRequiredError) return;
      toast.error(
        tCommon(
          error instanceof ConnectorConnectionPopupBlockedError
            ? 'taskTemplate.action.connect.popupBlocked'
            : 'taskTemplate.action.connect.error',
        ),
      );
    }
  };

  const handleRemove = async () => {
    try {
      await removePlugin(tool.id);
    } catch (error) {
      console.error('[ToolAuthAlert] Failed to remove plugin:', error);
    }
  };

  const icon =
    typeof tool.icon === 'string' ? (
      <Avatar alt={tool.label} avatar={tool.icon} size={20} style={{ flex: 'none' }} />
    ) : (
      <Icon fill={cssVar.colorText} icon={tool.icon} size={20} />
    );

  return (
    <Flexbox
      horizontal
      align="center"
      className={cx(styles.row)}
      gap={12}
      justify="space-between"
      style={{ cursor: 'pointer' }}
      onClick={handleAuthorize}
    >
      <Flexbox horizontal align="center" gap={8}>
        {icon}
        <Text>{tool.label}</Text>
        <ActionIcon
          className={cx('tool-auth-remove', styles.removeIcon)}
          icon={XIcon}
          size="small"
          title={t('toolAuth.remove')}
          onClick={(event) => {
            event.stopPropagation();
            void handleRemove();
          }}
        />
      </Flexbox>
      <Button
        disabled={isConnecting}
        icon={PlusIcon}
        loading={isConnecting}
        size="small"
        type="text"
        onClick={(event) => {
          event.stopPropagation();
          void handleAuthorize();
        }}
      >
        {isConnecting ? t('toolAuth.authorizing') : t('toolAuth.authorize')}
      </Button>
    </Flexbox>
  );
};

interface MarketToolAuthItemProps {
  tool: PendingMarketTool;
}

const MarketToolAuthItem = memo<MarketToolAuthItemProps>(({ tool }) => {
  const { t } = useTranslation('chat');
  const { signIn, isLoading } = useMarketAuth();
  const removePlugin = useAgentStore((s) => s.removePlugin);

  const handleSignIn = async () => {
    try {
      await signIn('sandbox');
    } catch (error) {
      console.error('[ToolAuthAlert] Market sign in failed:', error);
    }
  };

  const handleRemove = async () => {
    try {
      await removePlugin(tool.identifier);
    } catch (error) {
      console.error('[ToolAuthAlert] Failed to remove plugin:', error);
    }
  };

  return (
    <Flexbox
      horizontal
      align="center"
      className={cx(styles.row)}
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
        <ActionIcon
          className={cx('tool-auth-remove', styles.removeIcon)}
          icon={XIcon}
          size="small"
          title={t('toolAuth.remove')}
          onClick={(e) => {
            e.stopPropagation();
            handleRemove();
          }}
        />
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

  const agentId = useConversationStore(contextSelectors.agentId);
  const plugins = useAgentStore(agentByIdSelectors.getAgentPluginsById(agentId), isEqual);
  const isComposioEnabled = useServerConfigStore(serverConfigSelectors.enableComposio);
  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
  const composioServers = useToolStore(composioStoreSelectors.getServers, isEqual);
  const lobehubServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  // Connections load asynchronously via `useFetchUserComposioConnections` (fired by
  // ChatInput on the same page). Until they arrive, `composioServers` is the empty
  // fallback — don't treat a missing server as "needs auth" or the card flashes a
  // false unauthorized state on refresh before the real status loads.
  const isComposioServersInit = useToolStore((s) => s.isComposioServersInit);
  const useFetchLobehubSkillConnections = useToolStore(
    (state) => state.useFetchLobehubSkillConnections,
  );
  const lobehubConnections = useFetchLobehubSkillConnections(isLobehubSkillEnabled);
  const isLobehubServersInit = !isLobehubSkillEnabled || !lobehubConnections.isLoading;
  const { isAuthenticated: isMarketAuthenticated } = useMarketAuth();

  const pendingAuthTools = useMemo(
    () =>
      resolvePendingAuthTools({
        availability: { composio: isComposioEnabled, lobehub: isLobehubSkillEnabled },
        composioInitialized: isComposioServersInit,
        composioServers,
        lobehubInitialized: isLobehubServersInit,
        lobehubServers,
        marketAuthenticated: isMarketAuthenticated,
        marketTools: MARKET_AUTH_TOOLS,
        plugins,
      }),
    [
      composioServers,
      isComposioEnabled,
      isComposioServersInit,
      isLobehubServersInit,
      isLobehubSkillEnabled,
      isMarketAuthenticated,
      lobehubServers,
      plugins,
    ],
  );

  // Don't render if no pending auth tools
  if (pendingAuthTools.length === 0) {
    return null;
  }

  return (
    <Alert
      showIcon={false}
      style={{ background: 'transparent', width: '100%' }}
      type="secondary"
      description={
        <>
          {t('toolAuth.hint')}
          <Divider dashed style={{ marginBlock: 12 }} />
          <Flexbox gap={12} style={{ marginTop: 8 }}>
            {pendingAuthTools.map((tool) => {
              if (tool.authType === 'composio') {
                return (
                  <ComposioToolAuthItem
                    key={tool.identifier}
                    tool={tool}
                    onAuthComplete={() => {
                      // Component will re-render and tool will be removed from list
                    }}
                  />
                );
              }
              if (tool.authType === 'lobehub') {
                return <LobehubToolAuthItem key={tool.id} tool={tool} />;
              }
              return <MarketToolAuthItem key={tool.identifier} tool={tool} />;
            })}
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
