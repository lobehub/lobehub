'use client';

import { type KlavisServerType } from '@lobechat/const';
import { Avatar, Button as LobeButton, DropdownMenu, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { Button } from 'antd';
import { cssVar } from 'antd-style';
import { Loader2, MoreHorizontalIcon, SquareArrowOutUpRight, Unplug } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createKlavisSkillDetailModal } from '@/features/SkillStore/SkillDetail';
import { usePermission } from '@/hooks/usePermission';
import { useToolStore } from '@/store/tool';
import { type KlavisServer } from '@/store/tool/slices/klavisStore';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { styles } from './style';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15_000;

interface KlavisSkillItemProps {
  isSelected?: boolean;
  onDelete?: () => void;
  onSelect?: () => void;
  server?: KlavisServer;
  serverType: KlavisServerType;
}

const KlavisSkillItem = memo<KlavisSkillItemProps>(
  ({ serverType, server, isSelected, onSelect, onDelete }) => {
    const { t } = useTranslation('setting');
    const { allowed: canCreate, reason: createReason } = usePermission('create_content');
    const { allowed: canEdit, reason: editReason } = usePermission('edit_own_content');
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
            console.info('[Klavis] Polling check (expected during auth):', error);
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
            console.info('[Klavis] COOP blocked window.closed access, falling back to polling');
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
      if (!canCreate || !canEdit) return;
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
      if (!canEdit) return;
      if (!server) return;
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
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
        return <Avatar alt={label} avatar={icon} size={16} />;
      }
      return <Icon fill={cssVar.colorText} icon={icon} size={16} />;
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
          <Tooltip title={!canCreate ? createReason : editReason}>
            <Button
              disabled={!canCreate || !canEdit}
              icon={<Icon icon={SquareArrowOutUpRight} />}
              type="default"
              onClick={handleConnect}
            >
              {t('tools.klavis.connect', { defaultValue: 'Connect' })}
            </Button>
          </Tooltip>
        );
      }

      if (server.status === KlavisServerStatus.PENDING_AUTH) {
        return (
          <Button
            disabled={!canCreate || !canEdit}
            icon={<Icon icon={SquareArrowOutUpRight} />}
            type="default"
            onClick={() => {
              if (!canCreate || !canEdit) return;
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
                disabled: !canEdit,
                icon: <Icon icon={Unplug} />,
                key: 'disconnect',
                label: t('tools.klavis.disconnect', { defaultValue: 'Disconnect' }),
                onClick: handleDisconnect,
              },
            ]}
          >
            <Tooltip title={editReason}>
              <LobeButton disabled={!canEdit} icon={MoreHorizontalIcon} />
            </Tooltip>
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
        gap={8}
        justify="space-between"
        style={{
          ...(isSelected ? { background: 'var(--ant-color-primary-bg)', borderRadius: 6 } : {}),
          ...(onSelect ? { cursor: 'pointer' } : {}),
        }}
        onClick={onSelect}
      >
        <Flexbox horizontal align="center" gap={8} style={{ flex: 1, overflow: 'hidden' }}>
          <Flexbox
            horizontal
            align="center"
            gap={8}
            style={{ cursor: onSelect ? undefined : 'pointer' }}
            onClick={
              onSelect
                ? undefined
                : () =>
                    createKlavisSkillDetailModal({
                      identifier: serverType.identifier,
                      serverName: serverType.serverName,
                    })
            }
          >
            <div className={`${styles.icon} ${!isConnected ? styles.disconnectedIcon : ''}`}>
              {renderIcon()}
            </div>
            <span className={`${styles.title} ${!isConnected ? styles.disconnectedTitle : ''}`}>
              {serverType.label}
            </span>
          </Flexbox>
          {!isConnected && renderStatus()}
        </Flexbox>
        {!onSelect && (
          <Flexbox horizontal align="center" gap={8}>
            {isConnected && renderStatus()}
            {renderAction()}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

KlavisSkillItem.displayName = 'KlavisSkillItem';

export default KlavisSkillItem;
