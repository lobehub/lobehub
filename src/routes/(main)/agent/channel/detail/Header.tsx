'use client';

import { ActionIcon, Flexbox, Tag } from '@lobehub/ui';
import { Button, Switch } from 'antd';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import InfoTooltip from '@/components/InfoTooltip';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import { BOT_RUNTIME_STATUSES, type BotRuntimeStatus } from '../../../../../types/botRuntimeStatus';
import { getPlatformIcon } from '../const';

interface HeaderProps {
  currentConfig?: { enabled: boolean };
  enabledValue?: boolean;
  onRefreshStatus?: () => void;
  onToggleEnable: (enabled: boolean) => void;
  platformDef: SerializedPlatformDefinition;
  refreshingStatus?: boolean;
  runtimeStatus?: BotRuntimeStatus;
  toggleLoading?: boolean;
}

const STATUS_TAG_COLORS: Partial<Record<BotRuntimeStatus, string>> = {
  [BOT_RUNTIME_STATUSES.connected]: 'success',
  [BOT_RUNTIME_STATUSES.dormant]: 'warning',
  [BOT_RUNTIME_STATUSES.failed]: 'error',
  [BOT_RUNTIME_STATUSES.queued]: 'processing',
  [BOT_RUNTIME_STATUSES.starting]: 'processing',
};

const Header = memo<HeaderProps>(
  ({
    platformDef,
    currentConfig,
    enabledValue,
    onRefreshStatus,
    onToggleEnable,
    refreshingStatus,
    runtimeStatus,
    toggleLoading,
  }) => {
    const { t } = useTranslation('agent');
    const PlatformIcon = getPlatformIcon(platformDef.name);
    const ColorIcon =
      PlatformIcon && 'Color' in PlatformIcon ? (PlatformIcon as any).Color : PlatformIcon;
    const effectiveEnabled = enabledValue ?? currentConfig?.enabled;

    const statusLabel = (() => {
      switch (runtimeStatus) {
        case BOT_RUNTIME_STATUSES.connected: {
          return t('channel.statusConnected');
        }
        case BOT_RUNTIME_STATUSES.failed: {
          return t('channel.statusFailed');
        }
        case BOT_RUNTIME_STATUSES.queued: {
          return t('channel.statusQueued');
        }
        case BOT_RUNTIME_STATUSES.starting: {
          return t('channel.statusStarting');
        }
        case BOT_RUNTIME_STATUSES.dormant: {
          return t('channel.statusDormant');
        }
        case BOT_RUNTIME_STATUSES.disconnected: {
          return t('channel.statusDisconnected');
        }
        default: {
          return undefined;
        }
      }
    })();
    const statusColor = runtimeStatus ? STATUS_TAG_COLORS[runtimeStatus] : undefined;

    return (
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        style={{
          borderBottom: '1px solid var(--ant-color-border)',
          maxWidth: 1024,
          padding: '16px 0',
          width: '100%',
        }}
      >
        <Flexbox horizontal align="center" gap={8}>
          {ColorIcon && <ColorIcon size={32} />}
          {platformDef.name}
          {statusLabel && (
            <Tag color={statusColor} size={'small'}>
              {statusLabel}
            </Tag>
          )}
          {onRefreshStatus && currentConfig?.enabled && (
            <ActionIcon
              icon={RefreshCw}
              loading={refreshingStatus}
              size={'small'}
              title={t('channel.refreshStatus')}
              onClick={onRefreshStatus}
            />
          )}
          {platformDef.documentation?.setupGuideUrl && (
            <a
              href={platformDef.documentation.setupGuideUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              <InfoTooltip title={t('channel.setupGuide')} />
            </a>
          )}
          {platformDef.documentation?.portalUrl && (
            <a href={platformDef.documentation.portalUrl} rel="noopener noreferrer" target="_blank">
              <Button icon={<ExternalLink size={14} />} size="small" type="link">
                {t('channel.openPlatform')}
              </Button>
            </a>
          )}
        </Flexbox>
        <Flexbox horizontal align="center" gap={8}>
          {currentConfig && (
            <>
              <span style={{ color: 'var(--ant-color-text-secondary)', fontSize: 14 }}>
                {effectiveEnabled ? t('channel.enabled') : t('channel.disabled')}
              </span>
              <Switch
                checked={effectiveEnabled}
                loading={toggleLoading}
                onChange={onToggleEnable}
              />
            </>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default Header;
