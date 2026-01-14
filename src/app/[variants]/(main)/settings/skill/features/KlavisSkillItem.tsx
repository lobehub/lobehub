'use client';

import { type KlavisServerType } from '@lobechat/const';
import { Flexbox, Icon, Image } from '@lobehub/ui';
import { Button } from 'antd';
import { createStyles, cssVar } from 'antd-style';
import { Loader2, SquareArrowOutUpRight, Unplug } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { type KlavisServer, KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;

const useStyles = createStyles(({ css, token }) => ({
  connected: css`
    font-size: 14px;
    color: ${token.colorSuccess};
  `,
  container: css`
    padding: 12px 0;
  `,
  disconnected: css`
    font-size: 14px;
    color: ${token.colorTextTertiary};
  `,
  error: css`
    font-size: 14px;
    color: ${token.colorError};
  `,
  icon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 48px;
    height: 48px;

    background: ${token.colorFillTertiary};
    border-radius: 12px;
  `,
  pending: css`
    font-size: 14px;
    color: ${token.colorWarning};
  `,
  title: css`
    font-size: 15px;
    font-weight: 500;
    color: ${token.colorText};
  `,
}));

interface KlavisSkillItemProps {
  server?: KlavisServer;
  serverType: KlavisServerType;
}

const KlavisSkillItem = memo<KlavisSkillItemProps>(({ serverType, server }) => {
  const { t } = useTranslation('setting');
  const { styles } = useStyles();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isWaitingAuth, setIsWaitingAuth] = useState(false);

  const oauthWindowRef = useRef<Window | null>(null);
  const windowCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userId = useUserStore(userProfileSelectors.userId);
  const createKlavisServer = useToolStore((s) => s.createKlavisServer);
  const refreshKlavisServerTools = useToolStore((s) => s.refreshKlavisServerTools);
  const removeKlavisServer = useToolStore((s) => s.removeKlavisServer);

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
    if (server?.status === KlavisServerStatus.CONNECTED && isWaitingAuth) {
      cleanup();
    }
  }, [server?.status, isWaitingAuth, cleanup]);

  const startFallbackPolling = useCallback(
    (serverName: string) => {
      if (pollIntervalRef.current) return;

      pollIntervalRef.current = setInterval(async () => {
        try {
          await refreshKlavisServerTools(serverName);
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
    (oauthWindow: Window, serverName: string) => {
      windowCheckIntervalRef.current = setInterval(() => {
        try {
          if (oauthWindow.closed) {
            if (windowCheckIntervalRef.current) {
              clearInterval(windowCheckIntervalRef.current);
              windowCheckIntervalRef.current = null;
            }
            oauthWindowRef.current = null;
            refreshKlavisServerTools(serverName);
          }
        } catch {
          console.log('[Klavis] COOP blocked window.closed access, falling back to polling');
          if (windowCheckIntervalRef.current) {
            clearInterval(windowCheckIntervalRef.current);
            windowCheckIntervalRef.current = null;
          }
          startFallbackPolling(serverName);
        }
      }, 500);
    },
    [refreshKlavisServerTools, startFallbackPolling],
  );

  const openOAuthWindow = useCallback(
    (oauthUrl: string, serverName: string) => {
      cleanup();
      setIsWaitingAuth(true);

      const oauthWindow = window.open(oauthUrl, '_blank', 'width=600,height=700');
      if (oauthWindow) {
        oauthWindowRef.current = oauthWindow;
        startWindowMonitor(oauthWindow, serverName);
      } else {
        startFallbackPolling(serverName);
      }
    },
    [cleanup, startWindowMonitor, startFallbackPolling],
  );

  const handleConnect = async () => {
    if (!userId) return;
    if (server) return;

    setIsConnecting(true);
    try {
      const newServer = await createKlavisServer({
        identifier: serverType.identifier,
        serverName: serverType.serverName,
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
      console.error('[Klavis] Failed to connect server:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!server) return;
    await removeKlavisServer(server.identifier);
  };

  const renderIcon = () => {
    const { icon, label } = serverType;
    if (typeof icon === 'string') {
      return <Image alt={label} height={24} src={icon} width={24} />;
    }
    return <Icon fill={cssVar.colorText} icon={icon} size={24} />;
  };

  const renderStatus = () => {
    if (!server) {
      return (
        <span className={styles.disconnected}>
          {t('tools.klavis.disconnected', { defaultValue: 'Disconnected' })}
        </span>
      );
    }

    switch (server.status) {
      case KlavisServerStatus.CONNECTED: {
        return <span className={styles.connected}>{t('tools.klavis.connected')}</span>;
      }
      case KlavisServerStatus.PENDING_AUTH: {
        return <span className={styles.pending}>{t('tools.klavis.authRequired')}</span>;
      }
      case KlavisServerStatus.ERROR: {
        return <span className={styles.error}>{t('tools.klavis.error')}</span>;
      }
      default: {
        return (
          <span className={styles.disconnected}>
            {t('tools.klavis.disconnected', { defaultValue: 'Disconnected' })}
          </span>
        );
      }
    }
  };

  const renderAction = () => {
    if (isConnecting || isWaitingAuth) {
      return (
        <Button disabled icon={<Icon icon={Loader2} spin />} type="default">
          {t('tools.klavis.connect', { defaultValue: 'Connect' })}
        </Button>
      );
    }

    if (!server) {
      return (
        <Button icon={<Icon icon={SquareArrowOutUpRight} />} onClick={handleConnect} type="default">
          {t('tools.klavis.connect', { defaultValue: 'Connect' })}
        </Button>
      );
    }

    if (server.status === KlavisServerStatus.PENDING_AUTH) {
      return (
        <Button
          icon={<Icon icon={SquareArrowOutUpRight} />}
          onClick={() => {
            if (server.oauthUrl) {
              openOAuthWindow(server.oauthUrl, server.identifier);
            }
          }}
          type="default"
        >
          {t('tools.klavis.pendingAuth', { defaultValue: 'Authorize' })}
        </Button>
      );
    }

    if (server.status === KlavisServerStatus.CONNECTED) {
      return (
        <Button icon={<Icon icon={Unplug} />} onClick={handleDisconnect} type="default">
          {t('tools.klavis.disconnect', { defaultValue: 'Disconnect' })}
        </Button>
      );
    }

    return null;
  };

  return (
    <Flexbox
      align="center"
      className={styles.container}
      gap={16}
      horizontal
      justify="space-between"
    >
      <Flexbox align="center" gap={16} horizontal style={{ flex: 1, overflow: 'hidden' }}>
        <div className={styles.icon}>{renderIcon()}</div>
        <Flexbox gap={4} style={{ overflow: 'hidden' }}>
          <span className={styles.title}>{serverType.label}</span>
          {renderStatus()}
        </Flexbox>
      </Flexbox>
      {renderAction()}
    </Flexbox>
  );
});

KlavisSkillItem.displayName = 'KlavisSkillItem';

export default KlavisSkillItem;
