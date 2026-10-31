'use client';

import { isDesktop } from '@lobechat/const';
import { getHeterogeneousAgentClientConfig } from '@lobechat/heterogeneous-agents/client';
import type { HeterogeneousProviderConfig } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  Flexbox,
  Icon,
  Popover,
  Snippet,
  Spin,
  Tag,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpCircle, ExternalLink, RefreshCw, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { electronSystemService } from '@/services/electron/system';

import { type DeviceCliState, getDeviceCommands, getNewerAgentCliVersion } from './deviceCliStatus';
import { useAgentCliLatestVersion } from './useAgentCliLatestVersion';
import { useDeviceCliStatus } from './useDeviceCliStatus';

const styles = stylex.create({
  card: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    paddingBlock: 16,
    paddingInline: 16,
  },
  metaText: {
    color: cssVar.colorTextSecondary,
    fontSize: 13,
  },
  popoverContent: {
    maxWidth: 'min(400px, 80vw)',
  },
  reasonDetails: {
    maxHeight: 200,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
});

interface DeviceCliStatusCardProps {
  deviceId: string;
  provider: HeterogeneousProviderConfig;
}

const openExternal = (url: string) => {
  const opened = isDesktop
    ? electronSystemService.openExternalLink(url)
    : Promise.resolve(window.open(url, '_blank', 'noopener,noreferrer'));
  opened.catch(console.error);
};

/**
 * The agent CLI on the device a heterogeneous agent is bound to, probed over
 * the device gateway rather than on whichever machine the profile is open.
 *
 * The device itself (name, platform, presence) is not repeated here: the
 * execution environment picker right above already shows it.
 *
 * The local-only controls of the desktop card are absent on purpose: a device
 * run resolves the CLI's default command itself and authenticates with the
 * device's own login, so a custom command or API mode would not apply there
 * (the host shows `ApiAuthLocalOnlyNotice` for an API-mode agent).
 */
export const DeviceCliStatusCard = memo<DeviceCliStatusCardProps>(({ deviceId, provider }) => {
  const { t } = useTranslation(['setting', 'chat']);
  const providerConfig = getHeterogeneousAgentClientConfig(provider.type);
  const displayName = providerConfig?.title || provider.type;
  const AgentIcon = providerConfig?.icon;
  const install =
    providerConfig && 'install' in providerConfig ? providerConfig.install : undefined;
  const signInCommand =
    providerConfig && 'auth' in providerConfig ? providerConfig.auth.signInCommand : undefined;
  const update = providerConfig && 'update' in providerConfig ? providerConfig.update : undefined;

  const { device, isRedetecting, redetect, state } = useDeviceCliStatus({
    agentType: provider.type,
    deviceId,
  });

  const deviceName =
    device?.friendlyName || device?.hostname || t('chat:heteroAgent.executionTarget.unknownDevice');

  const { data: latestVersion } = useAgentCliLatestVersion(
    update && state.status === 'available' ? provider.type : undefined,
  );
  const newerVersion =
    state.status === 'available'
      ? getNewerAgentCliVersion(state.version, latestVersion)
      : undefined;
  const updateCommands =
    newerVersion && update ? getDeviceCommands(update.commands, device?.platform) : [];

  const renderStatusTag = (current: DeviceCliState) => {
    switch (current.status) {
      case 'available': {
        return <Tag color="success">{t('settingSystemTools.status.available')}</Tag>;
      }
      case 'unavailable':
      case 'deviceMissing': {
        return <Tag color="error">{t('settingSystemTools.status.unavailable')}</Tag>;
      }
      case 'offline': {
        return <Tag>{t('chat:heteroAgent.executionTarget.offline')}</Tag>;
      }
      case 'scanFailed': {
        return <Tag color="warning">{t('heterogeneousStatus.device.scanFailedTag')}</Tag>;
      }
      default: {
        return <Tag>{t('settingSystemTools.detecting')}</Tag>;
      }
    }
  };

  const renderStatusMeta = (current: DeviceCliState): ReactNode => {
    const params = { device: deviceName, name: displayName };
    switch (current.status) {
      case 'available': {
        return (
          <>
            {current.version && <Tag color="processing">{current.version}</Tag>}
            {newerVersion && updateCommands.length > 0 && (
              <Popover
                placement={'bottomLeft'}
                trigger={'click'}
                content={
                  <Flexbox gap={8} {...stylex.props(styles.popoverContent)}>
                    <Text fontSize={12} type={'secondary'}>
                      {t('heterogeneousStatus.update.desc', params)}
                    </Text>
                    {updateCommands.map((command) => (
                      <Snippet key={command} language={'bash'}>
                        {command}
                      </Snippet>
                    ))}
                  </Flexbox>
                }
              >
                <Button icon={<ArrowUpCircle size={14} />} size={'small'} type={'text'}>
                  {t('heterogeneousStatus.update.available', { version: newerVersion })}
                </Button>
              </Popover>
            )}
          </>
        );
      }
      case 'checking': {
        return (
          <Flexbox horizontal align="center" gap={8}>
            <Spin size="small" style={{ opacity: 0.6 }} />
            <Text {...stylex.props(styles.metaText)}>
              {t('heterogeneousStatus.device.detecting', params)}
            </Text>
          </Flexbox>
        );
      }
      case 'unavailable': {
        return (
          <Flexbox horizontal align="center" gap={8}>
            <Icon color="var(--lobe-color-error)" icon={XCircle} size={16} />
            <Text {...stylex.props(styles.metaText)}>
              {t('heterogeneousStatus.device.unavailable', params)}
            </Text>
          </Flexbox>
        );
      }
      case 'offline': {
        return (
          <Text {...stylex.props(styles.metaText)}>
            {t('heterogeneousStatus.device.offline', params)}
          </Text>
        );
      }
      case 'deviceMissing': {
        return (
          <Text {...stylex.props(styles.metaText)}>{t('heterogeneousStatus.device.missing')}</Text>
        );
      }
      case 'scanFailed': {
        // One readable line; the raw probe reason (a gateway or device-client
        // message) stays folded behind a click, as the device CLI update does.
        return (
          <Flexbox horizontal align="center" gap={4} wrap={'wrap'}>
            <Text {...stylex.props(styles.metaText)}>
              {t('heterogeneousStatus.device.scanFailed', params)}
            </Text>
            {current.reason && (
              <Popover
                placement={'bottomLeft'}
                styles={{ content: { maxWidth: 'min(400px, 80vw)' } }}
                trigger={'click'}
                content={
                  <Text fontSize={12} {...stylex.props(styles.reasonDetails)}>
                    {current.reason}
                  </Text>
                }
              >
                <Button size={'small'} type={'text'}>
                  {t('heterogeneousStatus.device.showDetails')}
                </Button>
              </Popover>
            )}
          </Flexbox>
        );
      }
    }
  };

  const installCommands =
    state.status === 'unavailable' && install
      ? getDeviceCommands(install.commands, device?.platform)
      : [];

  return (
    <Flexbox {...stylex.props(styles.card)} gap={12}>
      <Flexbox horizontal align="flex-start" gap={12} justify="space-between">
        <Flexbox flex={1} gap={8} style={{ minWidth: 0 }}>
          <Flexbox horizontal align="center" gap={8}>
            {AgentIcon && <AgentIcon size={16} />}
            <Text strong>{`${displayName} CLI`}</Text>
          </Flexbox>
          <Flexbox horizontal align="center" gap={8} wrap={'wrap'}>
            {renderStatusTag(state)}
            {renderStatusMeta(state)}
          </Flexbox>
        </Flexbox>
        <Tooltip title={t('heterogeneousStatus.redetect')}>
          <ActionIcon
            aria-label={t('heterogeneousStatus.redetect')}
            disabled={isRedetecting}
            icon={RefreshCw}
            loading={isRedetecting}
            size="small"
            onClick={redetect}
          />
        </Tooltip>
      </Flexbox>

      {installCommands.length > 0 && install && (
        <Flexbox gap={8}>
          <Text strong>{t('heterogeneousStatus.device.installTitle', { device: deviceName })}</Text>
          <Text fontSize={12} type={'secondary'}>
            {t('heterogeneousStatus.device.installDesc', { device: deviceName })}
          </Text>
          {installCommands.map((command) => (
            <Snippet key={command} language={'bash'}>
              {command}
            </Snippet>
          ))}
          {signInCommand && (
            <Text fontSize={12} type={'secondary'}>
              {t('heterogeneousStatus.device.afterInstall', { command: signInCommand })}
            </Text>
          )}
          <Flexbox horizontal justify="flex-end">
            <Button
              icon={<ExternalLink size={14} />}
              size="small"
              onClick={() => openExternal(install.docsUrl)}
            >
              {t('heterogeneousStatus.device.openDocs')}
            </Button>
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
});

DeviceCliStatusCard.displayName = 'DeviceCliStatusCard';
