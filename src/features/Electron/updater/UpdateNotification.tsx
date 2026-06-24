import { type UpdateInfo } from '@lobechat/electron-client-ipc';
import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Button, Flexbox, Icon, Markdown } from '@lobehub/ui';
import { Button as BaseButton, createModal, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { t } from 'i18next';
import { CircleFadingArrowUp } from 'lucide-react';
import React, { memo, useState } from 'react';
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

interface UpdateDetailContentProps {
  updateInfo: UpdateInfo;
}

const UpdateDetailContent = memo<UpdateDetailContentProps>(({ updateInfo }) => {
  const { t: tElectron } = useTranslation('electron');
  const { close } = useModalContext();
  const [isInstalling, setIsInstalling] = useState(false);

  return (
    <Flexbox gap={12} style={{ maxWidth: 480 }}>
      <div style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>{updateInfo.version}</div>
      {updateInfo.releaseNotes &&
        (typeof updateInfo.releaseNotes === 'string' ? (
          <div className={styles.releaseNote}>
            <Markdown>{updateInfo.releaseNotes}</Markdown>
          </div>
        ) : (
          <div className={styles.releaseNote}>
            {updateInfo.releaseNotes.map((note) => (
              <Markdown key={note.version}>{note.note ?? ''}</Markdown>
            ))}
          </div>
        ))}
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <BaseButton
          size={'small'}
          onClick={() => {
            autoUpdateService.installLater();
            close();
          }}
        >
          {tElectron('updater.installLater')}
        </BaseButton>
        <BaseButton
          loading={isInstalling}
          size={'small'}
          type={'primary'}
          onClick={() => {
            setIsInstalling(true);
            autoUpdateService.installNow();
          }}
        >
          {tElectron('updater.restartAndInstall')}
        </BaseButton>
      </Flexbox>
    </Flexbox>
  );
});

UpdateDetailContent.displayName = 'UpdateDetailContent';

const openUpdateDetailModal = (updateInfo: UpdateInfo) =>
  createModal({
    content: <UpdateDetailContent updateInfo={updateInfo} />,
    footer: null,
    maskClosable: true,
    title: t('updater.updateReady', { ns: 'electron' }),
    width: 520,
  });

export const UpdateNotification: React.FC = () => {
  const { t: tElectron } = useTranslation('electron');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [installConfirmMode, setInstallConfirmMode] = useState<
    'unconfirm' | 'installLater' | 'installNow' | null
  >('unconfirm');
  const [isInstalling, setIsInstalling] = useState(false);

  useWatchBroadcast('updateDownloaded', (info: UpdateInfo) => {
    setUpdateInfo(info);
    setUpdateDownloaded(true);
    setUpdateAvailable(false);
    setInstallConfirmMode('unconfirm');
  });

  useWatchBroadcast('updateWillInstallLater', () => {
    setInstallConfirmMode('installLater');

    setTimeout(() => setInstallConfirmMode(null), 5000);
  });

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
        {tElectron('updater.willInstallLater')}
      </div>
    );
  }

  if (installConfirmMode === 'unconfirm')
    return (
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
          <div
            style={{ cursor: 'pointer', fontSize: 12 }}
            onClick={() => {
              if (updateInfo) openUpdateDetailModal(updateInfo);
            }}
          >
            {tElectron('updater.updateReady')}
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
            {tElectron('updater.later')}
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
            {tElectron('updater.upgradeNow')}
          </Button>
        </div>
      </div>
    );

  return null;
};
