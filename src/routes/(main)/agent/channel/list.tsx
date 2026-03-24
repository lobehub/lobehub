'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx, useTheme } from 'antd-style';
import { Info } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

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
  title: css`
    padding-inline: 4px;
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface PlatformListProps {
  activeId: string;
  onSelect: (id: string) => void;
  platforms: SerializedPlatformDefinition[];
  runtimeStatuses: Map<string, BotRuntimeStatus>;
}

const PlatformList = memo<PlatformListProps>(
  ({ platforms, activeId, onSelect, runtimeStatuses }) => {
    const { t } = useTranslation('agent');
    const theme = useTheme();

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
          <div className={styles.title}>{t('channel.platforms')}</div>
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
        <div style={{ borderTop: `1px solid ${theme.colorBorder}`, padding: 12 }}>
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
            <Icon icon={Info} size={'small'} /> {t('channel.documentation')}
          </a>
        </div>
      </aside>
    );
  },
);

export default PlatformList;
