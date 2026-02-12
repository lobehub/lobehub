'use client';

import { type LobehubSkillProviderType } from '@lobechat/const';
import { Avatar, Button as LobeButton, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { App, Button } from 'antd';
import { cssVar } from 'antd-style';
import { Loader2, MoreHorizontalIcon, SquareArrowOutUpRight, Unplug } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createLobehubSkillDetailModal } from '@/features/SkillStore/SkillDetail';
import { useToolStore } from '@/store/tool';
import { type LobehubSkillServer } from '@/store/tool/slices/lobehubSkillStore/types';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import { styles } from './style';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;

interface LobehubSkillItemProps {
  provider: LobehubSkillProviderType;
  server?: LobehubSkillServer;
}

const LobehubSkillItem = memo<LobehubSkillItemProps>(({ provider, server }) => {
  const { t } = useTranslation('setting');
  const { modal } = App.useApp();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isWaitingAuth, setIsWaitingAuth] = useState(false);

  const oauthWindowRef = useRef<Window | null>(null);
  const windowCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkStatus = useToolStore((s) => s.checkLobehubSkillStatus);
  const revokeConnect = useToolStore((s) => s.revokeLobehubSkill);
  const getAuthorizeUrl = useToolStore((s) => s.getLobehubSkillAuthorizeUrl);

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
    if (server?.status === LobehubSkillStatus.CONNECTED && isWaitingAuth) {
      cleanup();
    }
  }, [server?.status, isWaitingAuth, cleanup]);

  const startFallbackPolling = useCallback(() => {
    if (pollIntervalRef.current) return;

    pollIntervalRef.current = setInterval(async () => {
      try {
        await checkStatus(provider.id);
      } catch (error) {
        console.error('[LobehubSkill] Failed to check status:', error);
      }
    }, POLL_INTERVAL_MS);

    pollTimeoutRef.current = setTimeout(() => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setIsWaitingAuth(false);
    }, POLL_TIMEOUT_MS);
  }, [checkStatus, provider.id]);

  const startWindowMonitor = useCallback(
    (oauthWindow: Window) => {
      windowCheckIntervalRef.current = setInterval(async () => {
        try {
          if (oauthWindow.closed) {
            if (windowCheckIntervalRef.current) {
              clearInterval(windowCheckIntervalRef.current);
              windowCheckIntervalRef.current = null;
            }
            oauthWindowRef.current = null;
            await checkStatus(provider.id);
            setIsWaitingAuth(false);
          }
        } catch {
          console.log('[LobehubSkill] COOP blocked window.closed access, falling back to polling');
          if (windowCheckIntervalRef.current) {
            clearInterval(windowCheckIntervalRef.current);
            windowCheckIntervalRef.current = null;
          }
          startFallbackPolling();
        }
      }, 500);
    },
    [checkStatus, provider.id, startFallbackPolling],
  );

  const openOAuthWindow = useCallback(
    (authorizeUrl: string) => {
      cleanup();
      setIsWaitingAuth(true);

      const oauthWindow = window.open(authorizeUrl, '_blank', 'width=600,height=700');
      if (oauthWindow) {
        oauthWindowRef.current = oauthWindow;
        startWindowMonitor(oauthWindow);
      } else {
        startFallbackPolling();
      }
    },
    [cleanup, startWindowMonitor, startFallbackPolling],
  );

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      if (
        event.data?.type === 'LOBEHUB_SKILL_AUTH_SUCCESS' &&
        event.data?.provider === provider.id
      ) {
        cleanup();
        await checkStatus(provider.id);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [provider.id, cleanup, checkStatus]);

  const handleConnect = async () => {
    if (server?.isConnected) return;

    setIsConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/oauth/callback/success?provider=${encodeURIComponent(provider.id)}`;
      const { authorizeUrl } = await getAuthorizeUrl(provider.id, { redirectUri });
      openOAuthWindow(authorizeUrl);
    } catch (error) {
      console.error('[LobehubSkill] Failed to get authorize URL:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    if (!server) return;
    modal.confirm({
      cancelText: t('cancel', { ns: 'common' }),
      centered: true,
      content: t('tools.lobehubSkill.disconnectConfirm.desc', { name: provider.label }),
      okButtonProps: { danger: true },
      okText: t('tools.lobehubSkill.disconnect'),
      onOk: async () => {
        await revokeConnect(server.identifier);
      },
      title: t('tools.lobehubSkill.disconnectConfirm.title', { name: provider.label }),
    });
  };

  const renderIcon = () => {
    const { icon, label } = provider;
    if (typeof icon === 'string') {
      return <Avatar alt={label} avatar={icon} size={32} />;
    }
    return <Icon fill={cssVar.colorText} icon={icon} size={32} />;
  };

  const renderStatus = () => {
    if (!server) {
      return (
        <span className={styles.disconnected}>
          {t('tools.lobehubSkill.disconnected', { defaultValue: 'Disconnected' })}
        </span>
      );
    }

    switch (server.status) {
      case LobehubSkillStatus.CONNECTED: {
        return (
          <span className={styles.connected}>
            {t('tools.lobehubSkill.connected', { defaultValue: 'Connected' })}
          </span>
        );
      }
      case LobehubSkillStatus.ERROR: {
        return <span className={styles.error}>{t('tools.lobehubSkill.error')}</span>;
      }
      default: {
        return (
          <span className={styles.disconnected}>
            {t('tools.lobehubSkill.disconnected', { defaultValue: 'Disconnected' })}
          </span>
        );
      }
    }
  };

  const renderAction = () => {
    if (isConnecting || isWaitingAuth) {
      return (
        <Button disabled icon={<Icon spin icon={Loader2} />} type="default">
          {t('tools.lobehubSkill.connect')}
        </Button>
      );
    }

    if (!server || server.status !== LobehubSkillStatus.CONNECTED) {
      return (
        <Button icon={<Icon icon={SquareArrowOutUpRight} />} type="default" onClick={handleConnect}>
          {t('tools.lobehubSkill.connect')}
        </Button>
      );
    }

    return (
      <DropdownMenu
        placement="bottomRight"
        items={[
          {
            icon: <Icon icon={Unplug} />,
            key: 'disconnect',
            label: t('tools.lobehubSkill.disconnect', { defaultValue: 'Disconnect' }),
            onClick: handleDisconnect,
          },
        ]}
      >
        <LobeButton icon={MoreHorizontalIcon} />
      </DropdownMenu>
    );
  };

  const isConnected = server?.status === LobehubSkillStatus.CONNECTED;

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
            createLobehubSkillDetailModal({
              identifier: provider.id,
            })
          }
        >
          <div className={`${styles.icon} ${!isConnected ? styles.disconnectedIcon : ''}`}>
            {renderIcon()}
          </div>
          <Flexbox gap={4} style={{ overflow: 'hidden' }}>
            <span className={`${styles.title} ${!isConnected ? styles.disconnectedTitle : ''}`}>
              {provider.label}
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

LobehubSkillItem.displayName = 'LobehubSkillItem';

export default LobehubSkillItem;
