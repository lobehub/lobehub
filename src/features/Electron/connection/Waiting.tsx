'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Button, Flexbox, Highlighter, Icon, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ShieldX } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useElectronStore } from '@/store/electron';

import WaitingAnim from './WaitingAnim';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    min-height: 100vh;

    color: ${cssVar.colorTextBase};

    background-color: ${cssVar.colorBgContainer};
  `,

  content: css`
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
  `,

  description: css`
    margin-block-end: ${cssVar.marginXL} !important;
    color: ${cssVar.colorTextSecondary} !important;
  `,

  errorIcon: css`
    margin-block-end: ${cssVar.marginXL};
    color: ${cssVar.colorError};
  `,

  errorMessage: css`
    margin-block-end: ${cssVar.marginXL} !important;
    color: ${cssVar.colorError} !important;
    text-align: center;
  `,

  helpText: css`
    margin-block-start: ${cssVar.marginLG};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,

  title: css`
    margin-block-end: ${cssVar.marginSM} !important;
    color: ${cssVar.colorText} !important;
  `,
}));

interface WaitingOAuthProps {
  setIsOpen: (open: boolean) => void;
  setWaiting: (waiting: boolean) => void;
}

const WaitingOAuth = memo<WaitingOAuthProps>(({ setWaiting, setIsOpen }) => {
  const { t } = useTranslation('electron');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const remoteServerSyncError = useElectronStore((s) => s.remoteServerSyncError);
  const [disconnect, refreshServerConfig, connectRemoteServer, clearRemoteServerSyncError] =
    useElectronStore((s) => [
      s.disconnectRemoteServer,
      s.refreshServerConfig,
      s.connectRemoteServer,
      s.clearRemoteServerSyncError,
    ]);

  const handleCancel = async () => {
    await disconnect();
    setWaiting(false);
    setErrorMessage(null);
    clearRemoteServerSyncError();
  };

  const handleRetry = async () => {
    setErrorMessage(null);
    clearRemoteServerSyncError();
    const { dataSyncConfig } = useElectronStore.getState();
    await connectRemoteServer(dataSyncConfig);
  };

  useEffect(() => {
    if (!remoteServerSyncError?.message) return;
    setErrorMessage(remoteServerSyncError.message);
  }, [remoteServerSyncError?.message]);

  useWatchBroadcast('authorizationSuccessful', async () => {
    setIsOpen(false);
    setWaiting(false);
    setErrorMessage(null);
    clearRemoteServerSyncError();
    await refreshServerConfig();
  });

  useWatchBroadcast('authorizationFailed', ({ error }) => {
    setErrorMessage(error);
  });

  // 错误状态
  if (errorMessage) {
    return (
      <div className={styles.container}>
        <Flexbox className={styles.content} gap={12}>
          <Flexbox align={'center'}>
            <Icon className={styles.errorIcon} icon={ShieldX} size={64} />
            <Text as={'h4'} className={styles.title}>
              {t('waitingOAuth.errorTitle')}
            </Text>
          </Flexbox>
          <Highlighter language={'log'} style={{ maxHeight: 500, maxWidth: 800, overflow: 'auto' }}>
            {errorMessage}
          </Highlighter>
          <Flexbox horizontal gap={12}>
            <Button onClick={handleCancel}>{t('waitingOAuth.cancel')}</Button>
            <Button type="primary" onClick={handleRetry}>
              {t('waitingOAuth.retry')}
            </Button>
          </Flexbox>
        </Flexbox>
      </div>
    );
  }

  // 正常等待状态
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <WaitingAnim />
        <Text as={'h4'} className={styles.title}>
          {t('waitingOAuth.title')}
        </Text>
        <Text className={styles.description}>{t('waitingOAuth.description')}</Text>
        <Button onClick={handleCancel}>{t('waitingOAuth.cancel')}</Button>
        <Text className={styles.helpText}>{t('waitingOAuth.helpText')}</Text>
      </div>
    </div>
  );
});

export default WaitingOAuth;
