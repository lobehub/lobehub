import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, confirmModal, Text } from '@lobehub/ui/base-ui';
import { CloudDownloadIcon, RotateCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useDeviceCliUpdate } from './useDeviceCliUpdate';

export const CliUpdate = ({
  deviceId,
  live,
  canEdit,
}: {
  deviceId: string;
  live: boolean;
  canEdit: boolean;
}) => {
  const { t } = useTranslation(['setting', 'common']);
  const update = useDeviceCliUpdate(deviceId, live, canEdit);
  const { state, view } = update;
  const confirm = (install: boolean, retry = false) =>
    confirmModal({
      cancelText: t('common:cancel'),
      content: t('devices.cliUpdate.confirmDesc'),
      okText: t(install ? 'devices.cliUpdate.update' : 'devices.cliUpdate.restart'),
      onOk: () => {
        void (retry ? update.retryCommand() : update.restart(install));
      },
      title: t(install ? 'devices.cliUpdate.update' : 'devices.cliUpdate.restart'),
    });
  const reason =
    view === 'unsupported'
      ? t('devices.cliUpdate.bootstrap')
      : view === 'failed'
        ? (state?.operation?.error ?? update.operation?.error)
        : undefined;
  if (!canEdit) return null;
  return (
    <Flexbox gap={4} style={{ paddingInlineStart: 16 }}>
      <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
        {canEdit && (
          <>
            {(update.error ||
              !live ||
              update.ambiguous ||
              view === 'failed' ||
              view === 'timedOut' ||
              (state?.activeTasks ?? 0) > 0) && (
              <Button
                loading={update.refreshing}
                size={'small'}
                type={'text'}
                onClick={update.retryRead}
              >
                {t('devices.cliUpdate.retryRead')}
              </Button>
            )}
            {live &&
              view !== 'unsupported' &&
              view !== 'pending' &&
              view !== 'timedOut' &&
              !update.ambiguous && (
                <>
                  <ActionIcon
                    aria-label={t('common:checkForUpdates')}
                    disabled={update.requesting}
                    icon={CloudDownloadIcon}
                    loading={update.requesting}
                    size={'small'}
                    title={t('common:checkForUpdates')}
                    onClick={update.check}
                  />
                  <ActionIcon
                    aria-label={t('devices.cliUpdate.restart')}
                    disabled={!update.allowed || update.requesting}
                    icon={RotateCwIcon}
                    size={'small'}
                    title={t('devices.cliUpdate.restart')}
                    onClick={() => confirm(false)}
                  />
                  {state?.latestVersion && (
                    <Button
                      disabled={!update.allowed || update.requesting}
                      size={'small'}
                      type={'fill'}
                      onClick={() => confirm(true)}
                    >
                      {t('devices.cliUpdate.update')}
                    </Button>
                  )}
                </>
              )}
            {(update.ambiguous || view === 'timedOut') && view !== 'success' && (
              <Button
                disabled={!update.allowed || update.requesting}
                loading={update.requesting}
                size={'small'}
                type={'text'}
                onClick={() => confirm(update.operation?.kind === 'update', true)}
              >
                {t('devices.cliUpdate.retryCommand')}
              </Button>
            )}
          </>
        )}
      </Flexbox>
      {view !== 'ready' && (
        <Text
          fontSize={12}
          type={
            view === 'failed' || view === 'timedOut' || view === 'unavailable'
              ? 'danger'
              : 'secondary'
          }
        >
          {t(`devices.cliUpdate.${view}`)}
          {reason && ` · ${reason}`}
        </Text>
      )}
      {state && state.activeTasks > 0 && (
        <Text fontSize={12} type={'secondary'}>
          {t('devices.cliUpdate.busy', { count: state.activeTasks })}
        </Text>
      )}
      {view === 'ready' && update.checked && !state?.latestVersion && !update.error && (
        <Text fontSize={12} type={'secondary'}>
          {t('common:alreadyUpToDate')}
        </Text>
      )}
      {state?.latestVersion && (
        <Text fontSize={12} type={'secondary'}>
          {t('devices.cliUpdate.available', { version: state.latestVersion })}
        </Text>
      )}
      {update.error && view !== 'unsupported' && (
        <Text fontSize={12} type={'danger'}>
          {update.error}
        </Text>
      )}
      {update.ambiguous && view !== 'success' && (
        <Text fontSize={12} type={'danger'}>
          {t('devices.cliUpdate.ambiguous')}
        </Text>
      )}
    </Flexbox>
  );
};
