'use client';

import { Button, confirmModal, createModal, Flexbox, Text } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useTfsConnection } from '@/features/Tfs/useTfsConnection';
import { tfsService } from '@/services/tfs';
import { tfsActions } from '@/store/tfs/action';

import { TfsBrowser } from './Browser';
import { TfsConnect } from './Connect';
import { TfsIcon } from './definition';

export const TfsIntegration = ({ onBack }: { onBack: () => void }) => {
  const { t } = useTranslation('integration');
  const status = useTfsConnection();
  const [error, setError] = useState<Error>();
  const connection = status.connection;
  const connect = () =>
    createModal({
      content: <TfsConnect collection={connection!.collectionUrl!} />,
      footer: null,
      title: t(connection?.identity ? 'tfs.updateCredentials' : 'tfs.connect'),
      width: 480,
    });
  const disconnect = () =>
    confirmModal({
      title: t('tfs.disconnect'),
      content: t('tfs.disconnectHint'),
      onOk: async () => {
        try {
          await tfsService.disconnect();
          await tfsActions.clear();
          await tfsActions.refresh({ kind: 'status' });
        } catch (cause) {
          setError(cause instanceof Error ? cause : new Error(t('tfs.disconnectFailed')));
          throw cause;
        }
      },
    });
  return (
    <Flexbox gap={24}>
      <Flexbox horizontal justify="space-between">
        <Button size="small" onClick={onBack}>
          {t('tfs.back')}
        </Button>
        <Button
          href={connection?.collectionUrl ?? 'https://learn.microsoft.com/azure/devops/'}
          rel="noopener noreferrer"
          size="small"
          target="_blank"
        >
          {t('tfs.docs')}
        </Button>
      </Flexbox>
      <Flexbox horizontal align="center" gap={16}>
        <TfsIcon size={40} />
        <Flexbox gap={4}>
          <Text strong fontSize={24}>
            TFS / Azure DevOps
          </Text>
          <Text type="secondary">{t('tfs.tagline')}</Text>
        </Flexbox>
      </Flexbox>
      <Text type="secondary">{t('tfs.personalHint')}</Text>
      {(status.error || error) && (
        <AsyncError error={status.error || error} onRetry={() => void status.revalidate()} />
      )}
      {!connection && !status.error && <Text>{t('tfs.loading')}</Text>}
      {connection && !connection.configured && <Text>{t('tfs.notConfigured')}</Text>}
      {connection?.hasBinding && !connection.identity && (
        <Text type="secondary">{t('tfs.error.TFS_DISCONNECT_FIRST')}</Text>
      )}
      {connection?.configured && (
        <Flexbox gap={12}>
          <Text>{connection.collectionUrl}</Text>
          {connection.identity && <Text strong>{connection.identity.login}</Text>}
          <Flexbox horizontal gap={8}>
            <Button type={connection.identity ? 'default' : 'primary'} onClick={connect}>
              {t(connection.identity ? 'tfs.updateCredentials' : 'tfs.connect')}
            </Button>
          </Flexbox>
          {connection.identity && (
            <TfsBrowser
              binding={connection.identity.updatedAt}
              key={connection.identity.updatedAt}
            />
          )}
        </Flexbox>
      )}
      {connection?.hasBinding && (
        <Button danger onClick={disconnect}>
          {t('tfs.disconnect')}
        </Button>
      )}
    </Flexbox>
  );
};
