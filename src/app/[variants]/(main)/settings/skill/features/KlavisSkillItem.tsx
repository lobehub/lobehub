'use client';

import { type KlavisServerType } from '@lobechat/const';
import { Avatar, Button as LobeButton, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { App, Button } from 'antd';
import { cssVar } from 'antd-style';
import { Loader2, MoreHorizontalIcon, SquareArrowOutUpRight, Unplug } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createKlavisSkillDetailModal } from '@/features/SkillStore/SkillDetail';
import { useToolStore } from '@/store/tool';
import { type KlavisServer } from '@/store/tool/slices/klavisStore';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { styles } from './style';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;

interface KlavisSkillItemProps {
  server?: KlavisServer;
  serverType: KlavisServerType;
}

const KlavisSkillItem = memo<KlavisSkillItemProps>(({ serverType, server }) => {
  const { t } = useTranslation('setting');
  const { modal } = App.useApp();
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
    (oauthWindow: Window, serverName: string) => {
      windowCheckIntervalRef.current = setInterval(async () => {
        try {
          if (oauthWindow.closed) {
            if (windowCheckIntervalRef.current) {
              clearInterval(windowCheckIntervalRef.current);
              windowCheckIntervalRef.current = null;
            }
            oauthWindowRef.current = null;
            // Start polling after window closes
            startFallbackPolling(serverName);
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

  const handleDisconnect = () => {
    if (!server) return;
    modal.confirm({
      cancelText: t('cancel', { ns: 'common' }),
      centered: true,
      content: t('tools.lobehubSkill.disconnectConfirm.desc', { name: serverType.label }),
      okButtonProps: { danger: true },
      okText: t('tools.lobehubSkill.disconnect'),
      onOk: async () => {
        await removeKlavisServer(server.identifier);
      },
      title: t('tools.lobehubSkill.disconnectConfirm.title', { name: serverType.label }),
    });
  };

  const renderIcon = () => {
    const { icon, label } = serverType;
    if (typeof icon === 'string') {
      return <Avatar alt={label} avatar={icon} size={32} />;
    }
    return <Icon fill={cssVar.colorText} icon={icon} size={32} />;
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
        <Button disabled icon={<Icon spin icon={Loader2} />} type="default">
          {t('tools.klavis.connect', { defaultValue: 'Connect' })}
        </Button>
      );
    }

    if (!server) {
      return (
        <Button icon={<Icon icon={SquareArrowOutUpRight} />} type="default" onClick={handleConnect}>
          {t('tools.klavis.connect', { defaultValue: 'Connect' })}
        </Button>
      );
    }

    if (server.status === KlavisServerStatus.PENDING_AUTH) {
      return (
        <Button
          icon={<Icon icon={SquareArrowOutUpRight} />}
          type="default"
          onClick={() => {
            if (server.oauthUrl) {
              openOAuthWindow(server.oauthUrl, server.identifier);
            }
          }}
        >
          {t('tools.klavis.pendingAuth', { defaultValue: 'Authorize' })}
        </Button>
      );
    }

    if (server.status === KlavisServerStatus.CONNECTED) {
      return (
        <DropdownMenu
          placement="bottomRight"
          items={[
            {
              danger: true,
              icon: <Icon icon={Unplug} />,
              key: 'disconnect',
              label: t('tools.klavis.disconnect', { defaultValue: 'Disconnect' }),
              onClick: handleDisconnect,
            },
          ]}
        >
          <LobeButton icon={MoreHorizontalIcon} />
        </DropdownMenu>
      );
    }

    return null;
  };

  const isConnected = server?.status === KlavisServerStatus.CONNECTED;

  return (
    <Flexbox
      horizontal
      align="center"
      className={styles.container}
      gap={16}
      justify="space-between"
    >
      <Flexbox horizontal align="center" gap={16} style={{ flex: 1, overflow: 'hidden' }}>
        <Flexbox
          horizontal
          align="center"
          gap={16}
          style={{ cursor: 'pointer' }}
          onClick={() =>
            createKlavisSkillDetailModal({
              identifier: serverType.identifier,
              serverName: serverType.serverName,
            })
          }
        >
          <div className={`${styles.icon} ${!isConnected ? styles.disconnectedIcon : ''}`}>
            {renderIcon()}
          </div>
          <Flexbox gap={4} style={{ overflow: 'hidden' }}>
            <span className={`${styles.title} ${!isConnected ? styles.disconnectedTitle : ''}`}>
              {serverType.label}
            </span>
            {!isConnected && renderStatus()}
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal align="center" gap={12}>
        {isConnected && renderStatus()}
        {renderAction()}
      </Flexbox>
    </Flexbox>
  );
});

KlavisSkillItem.displayName = 'KlavisSkillItem';

export default KlavisSkillItem;
