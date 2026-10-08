import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, confirmModal, Popover, Text } from '@lobehub/ui/base-ui';
import { RotateCwIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceCliUpdate } from './useDeviceCliUpdate';

export const CliUpdate = ({
  children,
  deviceId,
  live,
  canEdit,
}: {
  children: (slots: { actions?: ReactNode; detail?: ReactNode }) => ReactNode;
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
  const operationError =
    view === 'failed' ? (state?.operation?.error ?? update.operation?.error) : undefined;
  const errorDetails =
    view === 'unsupported'
      ? undefined
      : [operationError, update.error].filter(Boolean).join('\n\n');
  if (!canEdit || (state?.activeTasks ?? 0) > 0) return children({});
  const actions = (
    <Flexbox horizontal align={'center'} gap={8} style={{ flex: 'none' }}>
      {(update.error || !live || update.ambiguous || view === 'failed' || view === 'timedOut') && (
        <Button loading={update.refreshing} size={'small'} type={'text'} onClick={update.retryRead}>
          {t('devices.cliUpdate.retryRead')}
        </Button>
      )}
      {live &&
        view !== 'unsupported' &&
        view !== 'pending' &&
        view !== 'timedOut' &&
        !update.ambiguous && (
          <>
            {state?.latestVersion ? (
              <>
                <Text fontSize={12} type={'secondary'}>
                  {t('devices.cliUpdate.available', { version: state.latestVersion })}
                </Text>
                <ActionIcon
                  aria-label={t('devices.cliUpdate.update')}
                  disabled={!update.allowed || update.requesting}
                  icon={RotateCwIcon}
                  loading={update.requesting}
                  size={'small'}
                  title={t('devices.cliUpdate.update')}
                  onClick={() => confirm(true)}
                />
              </>
            ) : view === 'ready' && update.checked && !update.error ? (
              <Text fontSize={12} type={'secondary'}>
                {t('common:alreadyUpToDate')}
              </Text>
            ) : (
              <Button
                disabled={update.requesting}
                loading={update.requesting}
                size={'small'}
                type={'text'}
                onClick={update.check}
              >
                {t('common:checkForUpdates')}
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
    </Flexbox>
  );
  const detail = (
    <Flexbox gap={4} style={{ paddingInlineStart: 16 }}>
      {view !== 'ready' && !(view === 'loading' && update.error) && (
        <Text
          fontSize={12}
          type={
            view === 'failed' || view === 'timedOut' || view === 'unavailable'
              ? 'danger'
              : 'secondary'
          }
        >
          {t(`devices.cliUpdate.${view}`)}
          {view === 'unsupported' && ` · ${t('devices.cliUpdate.bootstrap')}`}
        </Text>
      )}
      {update.error && view !== 'unsupported' && (
        <Text fontSize={12} type={'danger'}>
          {t('devices.cliUpdate.requestFailed')}
        </Text>
      )}
      {errorDetails && (
        <Popover
          placement={'bottomLeft'}
          styles={{ content: { maxWidth: 'min(400px, 80vw)' } }}
          trigger={'click'}
          content={
            <Text
              fontSize={12}
              style={{
                maxHeight: 200,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {errorDetails}
            </Text>
          }
        >
          <Button size={'small'} style={{ alignSelf: 'flex-start' }} type={'text'}>
            {t('devices.cliUpdate.showDetails')}
          </Button>
        </Popover>
      )}
      {update.ambiguous && view !== 'success' && (
        <Text fontSize={12} type={'danger'}>
          {t('devices.cliUpdate.ambiguous')}
        </Text>
      )}
    </Flexbox>
  );
  return children({ actions, detail });
};
