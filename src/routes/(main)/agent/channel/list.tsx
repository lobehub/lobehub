'use client';

import { exportJSONFile } from '@lobechat/utils/client';
import { Icon } from '@lobehub/ui';
import { App, Dropdown, type MenuProps } from 'antd';
import { createStaticStyles, cx, useTheme } from 'antd-style';
import { Book, Download, MoreHorizontal, Trash2, Upload } from 'lucide-react';
import { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';
import { useAgentStore } from '@/store/agent';
import type { BotProviderItem } from '@/store/agent/slices/bot/action';

import { BOT_RUNTIME_STATUSES, type BotRuntimeStatus } from '../../../../types/botRuntimeStatus';
import { getPlatformIcon } from './const';

const styles = createStaticStyles(({ css, cssVar }) => ({
  item: css`
    cursor: pointer;

    display: flex;
    gap: 12px;
    align-items: center;

    width: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border: none;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};
    text-align: start;

    background: transparent;

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }

    &.active {
      font-weight: 500;
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  list: css`
    overflow-y: auto;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;

    padding: 12px;
    padding-block-start: 16px;
  `,
  root: css`
    display: flex;
    flex-direction: column;
    flex-shrink: 0;

    width: 260px;
    border-inline-end: 1px solid ${cssVar.colorBorder};
  `,
  statusDot: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;

    background: ${cssVar.colorSuccess};
    box-shadow: 0 0 0 1px ${cssVar.colorBgContainer};
  `,
}));

interface PlatformListProps {
  activeId: string;
  agentId: string;
  onSelect: (id: string) => void;
  platforms: SerializedPlatformDefinition[];
  providers?: BotProviderItem[];
  runtimeStatuses: Map<string, BotRuntimeStatus>;
}

const PlatformList = memo<PlatformListProps>(
  ({ platforms, activeId, agentId, onSelect, providers, runtimeStatuses }) => {
    const { t } = useTranslation('agent');
    const theme = useTheme();
    const { modal, message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const deleteAllBotProviders = useAgentStore((s) => s.deleteAllBotProviders);
    const createBotProvider = useAgentStore((s) => s.createBotProvider);
    const connectBot = useAgentStore((s) => s.connectBot);

    const handleExport = useCallback(() => {
      if (!providers?.length) return;
      const exportData = providers.map(({ id: _, ...rest }) => rest);
      exportJSONFile(exportData, `lobehub-channels-${agentId}.json`);
    }, [providers, agentId]);

    const handleImport = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

    const handleFileChange = useCallback(
      async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
          const text = await file.text();
          const data = JSON.parse(text);

          if (!Array.isArray(data)) {
            message.error(t('channel.importInvalidFormat'));
            return;
          }

          for (const item of data) {
            if (!item.platform || !item.applicationId || !item.credentials) {
              message.error(t('channel.importInvalidFormat'));
              return;
            }
          }

          for (const item of data) {
            await createBotProvider({
              agentId,
              applicationId: item.applicationId,
              credentials: item.credentials,
              platform: item.platform,
              settings: item.settings ?? undefined,
            });
            if (item.enabled) {
              await connectBot({
                agentId,
                applicationId: item.applicationId,
                platform: item.platform,
              });
            }
          }

          message.success(t('channel.importSuccess'));
        } catch {
          message.error(t('channel.importFailed'));
        } finally {
          e.target.value = '';
        }
      },
      [agentId, connectBot, createBotProvider, message, t],
    );

    const handleDeleteAll = useCallback(() => {
      if (!providers?.length) return;
      modal.confirm({
        content: t('channel.deleteAllConfirmDesc'),
        okButtonProps: { danger: true },
        okText: t('channel.deleteAllChannels'),
        onOk: async () => {
          try {
            await deleteAllBotProviders(agentId);
            message.success(t('channel.deleteAllSuccess'));
          } catch {
            message.error(t('channel.deleteAllFailed'));
          }
        },
        title: t('channel.deleteAllConfirm'),
        type: 'warning',
      });
    }, [agentId, deleteAllBotProviders, message, modal, providers, t]);

    const hasProviders = !!providers?.length;
    const menuItems: MenuProps['items'] = [
      {
        icon: <Icon icon={Download} size={'small'} />,
        key: 'export',
        disabled: !hasProviders,
        label: t('channel.exportConfig'),
        onClick: handleExport,
      },
      {
        icon: <Icon icon={Upload} size={'small'} />,
        key: 'import',
        label: t('channel.importConfig'),
        onClick: handleImport,
      },
      { type: 'divider' },
      {
        danger: true,
        disabled: !hasProviders,
        icon: <Icon icon={Trash2} size={'small'} />,
        key: 'deleteAll',
        label: t('channel.deleteAllChannels'),
        onClick: handleDeleteAll,
      },
    ];

    const getStatusColor = (status?: BotRuntimeStatus) => {
      switch (status) {
        case BOT_RUNTIME_STATUSES.connected: {
          return theme.colorSuccess;
        }
        case BOT_RUNTIME_STATUSES.failed: {
          return theme.colorError;
        }
        case BOT_RUNTIME_STATUSES.queued:
        case BOT_RUNTIME_STATUSES.starting: {
          return theme.colorInfo;
        }
        case BOT_RUNTIME_STATUSES.disconnected: {
          return theme.colorTextQuaternary;
        }
        default: {
          return undefined;
        }
      }
    };

    const getStatusTitle = (status?: BotRuntimeStatus) => {
      switch (status) {
        case BOT_RUNTIME_STATUSES.connected: {
          return t('channel.connectSuccess');
        }
        case BOT_RUNTIME_STATUSES.failed: {
          return t('channel.connectFailed');
        }
        case BOT_RUNTIME_STATUSES.queued: {
          return t('channel.connectQueued');
        }
        case BOT_RUNTIME_STATUSES.starting: {
          return t('channel.connectStarting');
        }
        case BOT_RUNTIME_STATUSES.disconnected: {
          return t('channel.runtimeDisconnected');
        }
        default: {
          return undefined;
        }
      }
    };

    return (
      <aside className={styles.root}>
        <div className={styles.list}>
          <input
            accept=".json"
            ref={fileInputRef}
            style={{ display: 'none' }}
            type="file"
            onChange={handleFileChange}
          />
          {platforms.map((platform) => {
            const PlatformIcon = getPlatformIcon(platform.name);
            const ColorIcon =
              PlatformIcon && 'Color' in PlatformIcon ? (PlatformIcon as any).Color : PlatformIcon;
            const runtimeStatus = runtimeStatuses.get(platform.id);
            const statusColor = getStatusColor(runtimeStatus);
            const statusTitle = getStatusTitle(runtimeStatus);
            return (
              <button
                className={cx(styles.item, activeId === platform.id && 'active')}
                key={platform.id}
                onClick={() => onSelect(platform.id)}
              >
                {ColorIcon && <ColorIcon size={20} />}
                <span style={{ flex: 1 }}>{platform.name}</span>
                {runtimeStatus && (
                  <div
                    className={styles.statusDot}
                    style={{ background: statusColor }}
                    title={statusTitle}
                  />
                )}
              </button>
            );
          })}
        </div>
        <div
          style={{
            alignItems: 'center',
            borderTop: `1px solid ${theme.colorBorder}`,
            display: 'flex',
            justifyContent: 'space-between',
            padding: 12,
          }}
        >
          <a
            href="https://lobehub.com/docs/usage/channels/overview"
            rel="noopener noreferrer"
            target="_blank"
            style={{
              alignItems: 'center',
              color: theme.colorTextSecondary,
              display: 'flex',
              fontSize: 12,
              gap: 4,
            }}
          >
            <Icon icon={Book} size={'small'} /> {t('channel.documentation')}
          </a>
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <button
              style={{
                background: 'transparent',
                border: 'none',
                borderRadius: 4,
                color: theme.colorTextQuaternary,
                cursor: 'pointer',
                display: 'flex',
                padding: 4,
              }}
            >
              <Icon icon={MoreHorizontal} size={'small'} />
            </button>
          </Dropdown>
        </div>
      </aside>
    );
  },
);

export default PlatformList;
