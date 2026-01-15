'use client';

import { getLobehubSkillProviderById } from '@lobechat/const';
import { ActionIcon, Block, Flexbox, Icon, Image } from '@lobehub/ui';
import { App } from 'antd';
import { createStyles, cssVar } from 'antd-style';
import type { Klavis } from 'klavis';
import { Loader2, Plus, Unplug } from 'lucide-react';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { klavisStoreSelectors, lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    position: relative;
    overflow: hidden;
    flex: 1;
    min-width: 0;
  `,
  description: css`
    overflow: hidden;

    font-size: 12px;
    color: ${token.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  icon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: 8px;

    background: ${token.colorFillTertiary};
  `,
  title: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    color: ${token.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface ItemProps {
  icon: string | React.ComponentType;
  identifier: string;
  isConnected: boolean;
  label: string;
  serverName?: Klavis.McpServerName;
  type: 'klavis' | 'lobehub';
}

const Item = memo<ItemProps>(({ icon, identifier, isConnected, label, serverName, type }) => {
  const { t } = useTranslation('setting');
  const { styles } = useStyles();
  const { modal } = App.useApp();
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
  const handleLobehubConnect = async () => {
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
  };

  // Handle connect for Klavis
  const handleKlavisConnect = async () => {
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
  };

  const handleConnect = type === 'lobehub' ? handleLobehubConnect : handleKlavisConnect;

  const handleDisconnect = () => {
    modal.confirm({
      cancelText: t('cancel', { ns: 'common' }),
      centered: true,
      content: t('tools.lobehubSkill.disconnectConfirm.desc', { name: label }),
      okButtonProps: { danger: true },
      okText: t('tools.lobehubSkill.disconnect'),
      onOk: async () => {
        if (type === 'lobehub' && lobehubServer) {
          await revokeLobehubConnect(lobehubServer.identifier);
        } else if (type === 'klavis' && klavisServer) {
          await removeKlavisServer(klavisServer.identifier);
        }
      },
      title: t('tools.lobehubSkill.disconnectConfirm.title', { name: label }),
    });
  };

  const renderIcon = () => {
    if (typeof icon === 'string') {
      return <Image alt={label} height={20} src={icon} width={20} />;
    }
    return <Icon fill={cssVar.colorText} icon={icon as any} size={20} />;
  };

  const renderAction = () => {
    if (isConnecting || isWaitingAuth) {
      return <ActionIcon icon={Loader2} loading />;
    }

    if (isConnected) {
      return (
        <ActionIcon
          icon={Unplug}
          onClick={handleDisconnect}
          title={t('tools.lobehubSkill.disconnect')}
        />
      );
    }

    return (
      <ActionIcon icon={Plus} onClick={handleConnect} title={t('tools.lobehubSkill.connect')} />
    );
  };

  return (
    <Block
      align={'center'}
      className={styles.container}
      gap={12}
      horizontal
      paddingBlock={12}
      paddingInline={12}
      variant={'filled'}
    >
      <div className={styles.icon}>{renderIcon()}</div>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0, overflow: 'hidden' }}>
        <span className={styles.title}>{label}</span>
      </Flexbox>
      {renderAction()}
    </Block>
  );
});

Item.displayName = 'LobeHubListItem';

export default Item;
