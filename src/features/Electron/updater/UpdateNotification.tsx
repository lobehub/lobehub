import { type UpdateInfo } from '@lobechat/electron-client-ipc';
import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Button, Flexbox, Icon } from '@lobehub/ui';
import { Modal } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleFadingArrowUp } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { autoUpdateService } from '@/services/electron/autoUpdate';

const styles = createStaticStyles(({ css, cssVar }) => ({
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

    background: ${cssVar.colorFillQuaternary};
  `,
}));

export const UpdateNotification: React.FC = () => {
  const { t } = useTranslation('electron');
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
          backgroundColor: cssVar.colorBgElevated,
          borderRadius: cssVar.borderRadius,
          bottom: 20,
          boxShadow: cssVar.boxShadow,
          color: cssVar.colorText,
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
              background: cssVar.colorBgElevated,
              border: `1px solid ${cssVar.colorBorderSecondary}`,
              borderRadius: 12,
              boxShadow: cssVar.boxShadow,
              color: cssVar.colorText,
              display: 'flex',
              gap: 8,
              padding: '8px 10px',
            }}
          >
            <Icon icon={CircleFadingArrowUp} style={{ fontSize: 16 }} />
            <div style={{ cursor: 'pointer', fontSize: 12 }} onClick={() => setDetailVisible(true)}>
              {t('updater.updateReady')}
              {updateInfo?.version ? ` · ${updateInfo.version}` : ''}
            </div>
            <div style={{ flex: 1 }} />
            <Button
              size="small"
              type="text"
              onClick={() => {
                autoUpdateService.installLater();
              }}
            >
              {t('updater.later')}
            </Button>

            <Button
              loading={isInstalling}
              size="small"
              type="primary"
              onClick={() => {
                setIsInstalling(true);
                autoUpdateService.installNow();
              }}
            >
              {t('updater.upgradeNow')}
            </Button>
          </div>
        </div>

        <Modal
          footer={null}
          open={detailVisible}
          title={t('updater.updateReady')}
          width={520}
          onCancel={() => setDetailVisible(false)}
        >
          <Flexbox gap={12} style={{ maxWidth: 480 }}>
            <div style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
              {updateInfo?.version}
            </div>
            {updateInfo?.releaseNotes && (
              <div
                className={styles.releaseNote}
                dangerouslySetInnerHTML={{ __html: updateInfo.releaseNotes }}
              />
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button size="small" onClick={() => autoUpdateService.installLater()}>
                {t('updater.installLater')}
              </Button>
              <Button
                loading={isInstalling}
                size="small"
                type="primary"
                onClick={() => {
                  setIsInstalling(true);
                  autoUpdateService.installNow();
                }}
              >
                {t('updater.restartAndInstall')}
              </Button>
            </div>
          </Flexbox>
        </Modal>
      </>
    );

  return null;
};
