'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button, confirmModal, Text } from '@lobehub/ui/base-ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import FieldLabel from '../FieldLabel';
import type { AppUpdateView } from './deriveAppUpdateView';
import { useDeviceAppUpdate } from './useDeviceAppUpdate';

const isChannel = (channel: string | null, prefix: 'cli' | 'desktop') =>
  !!channel && (channel === prefix || channel.startsWith(`${prefix}-`));

interface AppUpdateSectionProps {
  canEdit: boolean;
  device: DeviceListItem;
}

/**
 * The device's desktop app version, with a remote update when the caller may
 * operate the machine: check → download (with progress) → restart into the
 * new version, confirmed only once the device reconnects on it.
 */
const AppUpdateSection = ({ canEdit, device }: AppUpdateSectionProps) => {
  const { t } = useTranslation(['setting', 'common']);

  const channels = device.channels ?? [];
  const hasDesktopChannel = channels.some((c) => isChannel(c.channel, 'desktop'));
  const hasCliChannel = channels.some((c) => isChannel(c.channel, 'cli'));

  const { check, currentVersion, install, requesting, view } = useDeviceAppUpdate({
    deviceId: device.deviceId,
    enabled: canEdit && hasDesktopChannel,
    hasCliChannel,
  });

  const reportedVersion = device.metadata?.appVersion;
  const tracking = view.kind !== 'loading' && view.kind !== 'unavailable';
  if (!hasDesktopChannel && !reportedVersion && !tracking) return null;

  const confirmInstall = (targetVersion: string) =>
    confirmModal({
      cancelText: t('common:cancel'),
      content: t('devices.appUpdate.confirmDesc'),
      okText: t('common:restartToUpdate'),
      onOk: install,
      title: t('devices.appUpdate.confirmTitle', { version: targetVersion }),
    });

  const renderAction = (current: AppUpdateView) => {
    switch (current.kind) {
      case 'idle': {
        return (
          <Button loading={requesting} size={'small'} onClick={check}>
            {t('common:checkForUpdates')}
          </Button>
        );
      }
      case 'checking': {
        return (
          <Button loading size={'small'}>
            {t('common:checkForUpdates')}
          </Button>
        );
      }
      case 'downloading': {
        return (
          <Button loading size={'small'}>
            {t('common:downloadingUpdate', { percent: current.progress ?? 0 })}
          </Button>
        );
      }
      case 'ready': {
        return (
          <Button
            loading={requesting}
            size={'small'}
            type={'primary'}
            onClick={() => confirmInstall(current.targetVersion)}
          >
            {t('common:restartToUpdate')}
          </Button>
        );
      }
      case 'restarting': {
        return (
          <Button loading size={'small'}>
            {t('devices.appUpdate.restarting')}
          </Button>
        );
      }
      case 'installFailed':
      case 'timedOut': {
        return (
          <Button loading={requesting} size={'small'} onClick={check}>
            {t('common:checkForUpdates')}
          </Button>
        );
      }
      default: {
        return null;
      }
    }
  };

  const renderHint = (current: AppUpdateView): ReactNode => {
    switch (current.kind) {
      case 'idle': {
        if (current.outcome === 'latest') return t('common:alreadyUpToDate');
        if (current.outcome)
          return t('devices.appUpdate.checkFailed', { message: current.outcome.error });
        return null;
      }
      case 'downloading': {
        return current.targetVersion
          ? t('devices.appUpdate.downloading', { version: current.targetVersion })
          : null;
      }
      case 'ready': {
        return t('devices.appUpdate.ready', { version: current.targetVersion });
      }
      case 'restarting': {
        return t('devices.appUpdate.restartingHint', { version: current.targetVersion });
      }
      case 'updated': {
        return t('devices.appUpdate.updated', { version: current.version });
      }
      case 'installFailed': {
        return t('devices.appUpdate.installFailed', { version: current.currentVersion });
      }
      case 'timedOut': {
        return t('devices.appUpdate.timedOut');
      }
      case 'unsupported': {
        return t(`devices.appUpdate.unsupported.${current.reason}`);
      }
      default: {
        return null;
      }
    }
  };

  // The live answer beats the registry: the row's metadata is whatever client
  // registered last, which may be `lh connect` on the same machine.
  const version = currentVersion ?? reportedVersion;
  const hint = renderHint(view);
  const failed =
    view.kind === 'installFailed' ||
    view.kind === 'timedOut' ||
    (view.kind === 'idle' && typeof view.outcome === 'object');

  return (
    <Flexbox gap={8}>
      <FieldLabel>{t('devices.appUpdate.title')}</FieldLabel>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Text>{version ? `v${version}` : '—'}</Text>
        {canEdit && hasDesktopChannel && renderAction(view)}
      </Flexbox>
      {hint && (
        <Text fontSize={12} type={failed ? 'danger' : 'secondary'}>
          {hint}
        </Text>
      )}
    </Flexbox>
  );
};

export default AppUpdateSection;
