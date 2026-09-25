'use client';

import { Button, confirmModal, Text } from '@lobehub/ui/base-ui';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { type AppUpdateView, getAppUpdateAction } from './deriveAppUpdateView';
import type { DeviceAppUpdate } from './useDeviceAppUpdate';

export { useDeviceAppUpdate } from './useDeviceAppUpdate';

interface AppUpdateProps {
  update: DeviceAppUpdate;
}

/**
 * The remote-update button on the desktop app's connection row: check →
 * download (with progress) → restart into the new version.
 */
export const AppUpdateAction = ({ update }: AppUpdateProps) => {
  const { t } = useTranslation(['setting', 'common']);
  const { check, install, refreshing, requesting, retry, view } = update;

  const confirmInstall = (targetVersion: string) =>
    confirmModal({
      cancelText: t('common:cancel'),
      content: t('devices.appUpdate.confirmDesc'),
      okText: t('common:restartToUpdate'),
      onOk: install,
      title: t('devices.appUpdate.confirmTitle', { version: targetVersion }),
    });

  switch (getAppUpdateAction(view)) {
    case 'check': {
      return (
        <Button loading={requesting} size={'small'} type={'text'} onClick={check}>
          {t('common:checkForUpdates')}
        </Button>
      );
    }
    case 'retry': {
      return (
        <Button loading={refreshing} size={'small'} type={'text'} onClick={retry}>
          {t('common:retry')}
        </Button>
      );
    }
    case 'checking': {
      return (
        <Button loading size={'small'} type={'text'}>
          {t('common:checkForUpdates')}
        </Button>
      );
    }
    case 'downloading': {
      return (
        <Button loading size={'small'} type={'text'}>
          {t('common:downloadingUpdate', {
            percent: view.kind === 'downloading' ? (view.progress ?? 0) : 0,
          })}
        </Button>
      );
    }
    case 'install': {
      return (
        view.kind === 'ready' && (
          <Button
            loading={requesting}
            size={'small'}
            type={'fill'}
            onClick={() => confirmInstall(view.targetVersion)}
          >
            {t('common:restartToUpdate')}
          </Button>
        )
      );
    }
    case 'restarting': {
      return (
        <Button loading size={'small'} type={'text'}>
          {t('devices.appUpdate.restarting')}
        </Button>
      );
    }
    default: {
      return null;
    }
  }
};

interface AppUpdateHintProps extends AppUpdateProps {
  style?: CSSProperties;
}

/** Where the update stands, on its own line under the desktop app's connection. */
export const AppUpdateHint = ({ style, update }: AppUpdateHintProps) => {
  const { t } = useTranslation(['setting', 'common']);
  const { view } = update;

  const renderHint = (current: AppUpdateView): ReactNode => {
    switch (current.kind) {
      case 'idle': {
        if (current.outcome === 'latest') return t('common:alreadyUpToDate');
        if (current.outcome)
          return t('devices.appUpdate.checkFailed', { message: current.outcome.error });
        return null;
      }
      case 'unavailable': {
        return t('devices.appUpdate.unavailable');
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

  const hint = renderHint(view);
  if (!hint) return null;

  const failed =
    view.kind === 'installFailed' ||
    view.kind === 'timedOut' ||
    view.kind === 'unavailable' ||
    (view.kind === 'idle' && typeof view.outcome === 'object');

  return (
    <Text fontSize={12} style={style} type={failed ? 'danger' : 'secondary'}>
      {hint}
    </Text>
  );
};
