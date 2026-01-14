'use client';

import { type LobehubSkillProviderType } from '@lobechat/const';
import { FormItem, Icon, Image } from '@lobehub/ui';
import { Button } from 'antd';
import { createStyles, cssVar } from 'antd-style';
import { Loader2, SquareArrowOutUpRight, Unplug } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import {
  type LobehubSkillServer,
  LobehubSkillStatus,
} from '@/store/tool/slices/lobehubSkillStore/types';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;

const useStyles = createStyles(({ css, token }) => ({
  connected: css`
    color: ${token.colorSuccess};
  `,
  description: css`
    font-size: 12px;
    color: ${token.colorTextSecondary};
  `,
  disconnected: css`
    color: ${token.colorTextTertiary};
  `,
  error: css`
    color: ${token.colorError};
  `,
  icon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;

    background: ${token.colorFillTertiary};
    border-radius: 8px;
  `,
}));

interface LobehubSkillItemProps {
  provider: LobehubSkillProviderType;
  server?: LobehubSkillServer;
}

const LobehubSkillItem = memo<LobehubSkillItemProps>(({ provider, server }) => {
  const { t } = useTranslation('setting');
  const { styles } = useStyles();
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
      windowCheckIntervalRef.current = setInterval(() => {
        try {
          if (oauthWindow.closed) {
            if (windowCheckIntervalRef.current) {
              clearInterval(windowCheckIntervalRef.current);
              windowCheckIntervalRef.current = null;
            }
            oauthWindowRef.current = null;
            checkStatus(provider.id);
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

  const handleDisconnect = async () => {
    if (!server) return;
    await revokeConnect(server.identifier);
  };

  const renderIcon = () => {
    const { icon, label } = provider;
    if (typeof icon === 'string') {
      return <Image alt={label} height={24} src={icon} width={24} />;
    }
    return <Icon fill={cssVar.colorText} icon={icon} size={24} />;
  };

  const renderStatus = () => {
    if (!server) {
      return <span className={styles.disconnected}>Disconnected</span>;
    }

    switch (server.status) {
      case LobehubSkillStatus.CONNECTED: {
        return <span className={styles.connected}>Connected</span>;
      }
      case LobehubSkillStatus.ERROR: {
        return <span className={styles.error}>{t('tools.lobehubSkill.error')}</span>;
      }
      default: {
        return <span className={styles.disconnected}>Disconnected</span>;
      }
    }
  };

  const renderAction = () => {
    if (isConnecting || isWaitingAuth) {
      return (
        <Button disabled icon={<Icon icon={Loader2} spin />} type="default">
          {t('tools.lobehubSkill.connect')}
        </Button>
      );
    }

    if (!server || server.status !== LobehubSkillStatus.CONNECTED) {
      return (
        <Button icon={<Icon icon={SquareArrowOutUpRight} />} onClick={handleConnect} type="default">
          {t('tools.lobehubSkill.connect')}
        </Button>
      );
    }

    return (
      <Button icon={<Icon icon={Unplug} />} onClick={handleDisconnect} type="default">
        {t('tools.lobehubSkill.disconnect', { defaultValue: 'Disconnect' })}
      </Button>
    );
  };

  return (
    <FormItem
      avatar={<div className={styles.icon}>{renderIcon()}</div>}
      desc={renderStatus()}
      label={provider.label}
    >
      {renderAction()}
    </FormItem>
  );
});

LobehubSkillItem.displayName = 'LobehubSkillItem';

export default LobehubSkillItem;
