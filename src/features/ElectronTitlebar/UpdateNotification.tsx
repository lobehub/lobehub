import { UpdateInfo, useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Button, Icon } from '@lobehub/ui';
import { Modal, theme } from 'antd';
import { createStyles } from 'antd-style';
import { CircleFadingArrowUp } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { autoUpdateService } from '@/services/electron/autoUpdate';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    position: fixed;
    z-index: 1000;
    inset-block-end: 16px;
    inset-inline-start: 16px;
  `,

  releaseNote: css`
    overflow: scroll;

    max-height: 300px;
    padding: 8px;
    border-radius: 8px;

    background: ${token.colorFillQuaternary};
  `,
}));

type UpdateViewStatus = 'hidden' | 'prompt' | 'deferred' | 'installing';

export const UpdateNotification: React.FC = () => {
  const { t } = useTranslation('electron');
  const { styles } = useStyles();
  const { token } = theme.useToken();

  const [viewStatus, setViewStatus] = useState<UpdateViewStatus>('hidden');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  useWatchBroadcast('updateDownloaded', (info: UpdateInfo) => {
    setUpdateInfo(info);
    setViewStatus('prompt');
    setDetailVisible(false);
  });

  useWatchBroadcast('updateWillInstallLater', () => {
    setViewStatus('deferred');
    setTimeout(() => setViewStatus('hidden'), 5000); // 5秒后自动隐藏提示
  });

  const isInstalling = viewStatus === 'installing';

  if (viewStatus === 'hidden') return null;

  if (viewStatus === 'deferred') {
    return (
      <div
        style={{
          backgroundColor: token.colorBgElevated,
          borderRadius: token.borderRadius,
          bottom: 20,
          boxShadow: token.boxShadow,
          color: token.colorText,
          left: 16,
          padding: '10px 16px',
          position: 'fixed',
          zIndex: 1000,
        }}
      >
        {t('updater.willInstallLater')}
      </div>
    );
  }

  // prompt or installing
  return (
    <>
      <div className={styles.container}>
        <div
          style={{
            alignItems: 'center',
            background: token.colorBgElevated,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 12,
            boxShadow: token.boxShadow,
            color: token.colorText,
            display: 'flex',
            gap: 8,
            padding: '8px 10px',
          }}
        >
          <Icon icon={CircleFadingArrowUp} style={{ fontSize: 16 }} />
          <div onClick={() => setDetailVisible(true)} style={{ cursor: 'pointer', fontSize: 12 }}>
            {t('updater.updateReady')}
            {updateInfo?.version ? ` · ${updateInfo.version}` : ''}
          </div>
          <div style={{ flex: 1 }} />
          <Button
            onClick={() => {
              autoUpdateService.installLater();
            }}
            size="small"
            type="text"
          >
            {t('updater.later')}
          </Button>

          <Button
            loading={isInstalling}
            onClick={() => {
              setViewStatus('installing');
              autoUpdateService.installNow();
            }}
            size="small"
            type="primary"
          >
            {t('updater.upgradeNow')}
          </Button>
        </div>
      </div>

      <Modal
        footer={null}
        onCancel={() => setDetailVisible(false)}
        open={detailVisible}
        title={t('updater.updateReady')}
        width={520}
      >
        <Flexbox gap={12} style={{ maxWidth: 480 }}>
          <div style={{ color: token.colorTextSecondary, fontSize: 12 }}>{updateInfo?.version}</div>
          {updateInfo?.releaseNotes && (
            <div
              className={styles.releaseNote}
              dangerouslySetInnerHTML={{ __html: updateInfo.releaseNotes }}
            />
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={() => autoUpdateService.installLater()} size="small">
              {t('updater.installLater')}
            </Button>
            <Button
              loading={isInstalling}
              onClick={() => {
                setViewStatus('installing');
                autoUpdateService.installNow();
              }}
              size="small"
              type="primary"
            >
              {t('updater.restartAndInstall', '立即安装')}
            </Button>
          </div>
        </Flexbox>
      </Modal>
    </>
  );
};
