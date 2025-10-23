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

export const UpdateNotification: React.FC = () => {
  const { t } = useTranslation('electron');
  const { styles } = useStyles();
  const { token } = theme.useToken();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [installConfirmMode, setInstallConfirmMode] = useState<
    'unconfirm' | 'installLater' | 'installNow' | null
  >('unconfirm');
  const [detailVisible, setDetailVisible] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  useWatchBroadcast('updateDownloaded', (info: UpdateInfo) => {
    setUpdateInfo(info);
    setUpdateDownloaded(true);
    setUpdateAvailable(false);
    setInstallConfirmMode('unconfirm');
    setDetailVisible(false);
  });

  useWatchBroadcast('updateWillInstallLater', () => {
    setInstallConfirmMode('installLater');

    setTimeout(() => setInstallConfirmMode(null), 5000); // 5秒后自动隐藏提示
  });

  // 没有更新或正在下载时不显示任何内容
  if (!updateDownloaded && !updateAvailable) return null;

  if (installConfirmMode === 'installLater') {
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

  if (installConfirmMode === 'unconfirm')
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
                setIsInstalling(true);
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
            <div style={{ color: token.colorTextSecondary, fontSize: 12 }}>
              {updateInfo?.version}
            </div>
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
                  setIsInstalling(true);
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

  return null;
};
