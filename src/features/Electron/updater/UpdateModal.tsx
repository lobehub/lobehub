import { type ProgressInfo, type UpdateInfo } from '@lobechat/electron-client-ipc';
import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { type ModalInstance } from '@lobehub/ui';
import { Button, createModal, Flexbox } from '@lobehub/ui';
import { App, Progress, Spin } from 'antd';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { autoUpdateService } from '@/services/electron/autoUpdate';
import { formatSpeed } from '@/utils/format';

type UpdateStage = 'checking' | 'available' | 'latest' | 'downloading' | 'downloaded';

interface ModalUpdateOptions {
  closable?: boolean;
  keyboard?: boolean;
  maskClosable?: boolean;
  title?: React.ReactNode;
}

interface UpdateModalContentProps {
  onClose: () => void;
  setModalProps: (props: ModalUpdateOptions) => void;
}

const UpdateModalContent = memo<UpdateModalContentProps>(({ onClose, setModalProps }) => {
  const { t } = useTranslation(['electron', 'common']);
  const { modal } = App.useApp();
  const errorHandledRef = useRef(false);
  const isClosingRef = useRef(false);

  const [stage, setStage] = useState<UpdateStage>('checking');
  const [updateAvailableInfo, setUpdateAvailableInfo] = useState<UpdateInfo | null>(null);
  const [downloadedInfo, setDownloadedInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [latestVersionInfo, setLatestVersionInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    const isDownloading = stage === 'downloading';
    const modalTitle = (() => {
      switch (stage) {
        case 'checking': {
          return t('updater.checkingUpdate');
        }
        case 'available': {
          return t('updater.newVersionAvailable');
        }
        case 'downloading': {
          return t('updater.downloadingUpdate');
        }
        case 'downloaded': {
          return t('updater.updateReady');
        }
        case 'latest': {
          return t('updater.isLatestVersion');
        }
        default: {
          return '';
        }
      }
    })();

    setModalProps({
      closable: !isDownloading,
      keyboard: !isDownloading,
      maskClosable: !isDownloading,
      title: modalTitle,
    });
  }, [setModalProps, stage, t]);

  useWatchBroadcast('manualUpdateAvailable', (info: UpdateInfo) => {
    if (isClosingRef.current) return;
    setStage('available');
    setUpdateAvailableInfo(info);
    setDownloadedInfo(null);
    setLatestVersionInfo(null);
  });

  useWatchBroadcast('manualUpdateNotAvailable', (info: UpdateInfo) => {
    if (isClosingRef.current) return;
    setStage('latest');
    setLatestVersionInfo(info);
    setUpdateAvailableInfo(null);
    setDownloadedInfo(null);
    setProgress(null);
  });

  useWatchBroadcast('updateDownloadStart', () => {
    if (isClosingRef.current) return;
    setStage('downloading');
    setProgress({ bytesPerSecond: 0, percent: 0, total: 0, transferred: 0 });
    setUpdateAvailableInfo(null);
    setLatestVersionInfo(null);
  });

  useWatchBroadcast('updateDownloadProgress', (progressInfo: ProgressInfo) => {
    if (isClosingRef.current) return;
    setProgress(progressInfo);
  });

  useWatchBroadcast('updateDownloaded', (info: UpdateInfo) => {
    if (isClosingRef.current) return;
    setStage('downloaded');
    setDownloadedInfo(info);
    setProgress(null);
    setUpdateAvailableInfo(null);
    setLatestVersionInfo(null);
  });

  useWatchBroadcast('updateError', (message: string) => {
    if (isClosingRef.current || errorHandledRef.current) return;
    errorHandledRef.current = true;
    isClosingRef.current = true;
    onClose();
    modal.error({ content: message, title: t('updater.updateError') });
  });

  const closeModal = () => {
    if (isClosingRef.current) return;
    errorHandledRef.current = true;
    isClosingRef.current = true;
    onClose();
  };

  const handleDownload = () => {
    if (!updateAvailableInfo) return;
    autoUpdateService.downloadUpdate();
  };

  const handleInstallNow = () => {
    autoUpdateService.installNow();
    closeModal();
  };

  const handleInstallLater = () => {
    autoUpdateService.installLater();
    closeModal();
  };

  const renderReleaseNotes = (notes?: UpdateInfo['releaseNotes']) => {
    if (!notes) return null;
    return (
      <div
        dangerouslySetInnerHTML={{ __html: notes as string }}
        style={{
          borderRadius: 4,
          marginTop: 8,
          maxHeight: 300,
          overflow: 'auto',
          padding: '8px 12px',
        }}
      />
    );
  };

  const renderBody = () => {
    switch (stage) {
      case 'checking': {
        return (
          <Spin spinning>
            <div style={{ padding: '20px', textAlign: 'center' }}>
              {t('updater.checkingUpdateDesc')}
            </div>
          </Spin>
        );
      }
      case 'available': {
        return (
          <>
            <h4>
              {t('updater.newVersionAvailableDesc', { version: updateAvailableInfo?.version })}
            </h4>
            {renderReleaseNotes(updateAvailableInfo?.releaseNotes)}
          </>
        );
      }
      case 'downloading': {
        const percent = progress ? Math.round(progress.percent) : 0;
        return (
          <div style={{ padding: '20px 0' }}>
            <Progress percent={percent} status="active" />
            <div style={{ fontSize: 12, marginTop: 8, textAlign: 'center' }}>
              {t('updater.downloadingUpdateDesc', { percent })}
              {progress && progress.bytesPerSecond > 0 && (
                <span>{formatSpeed(progress.bytesPerSecond)}</span>
              )}
            </div>
          </div>
        );
      }
      case 'downloaded': {
        return (
          <>
            <h4>{t('updater.updateReadyDesc', { version: downloadedInfo?.version })}</h4>
            {renderReleaseNotes(downloadedInfo?.releaseNotes)}
          </>
        );
      }
      case 'latest': {
        return <p>{t('updater.isLatestVersionDesc', { version: latestVersionInfo?.version })}</p>;
      }
      default: {
        return null;
      }
    }
  };

  const renderActions = () => {
    if (stage === 'downloading') return null;

    let actions: React.ReactNode[] = [];

    if (stage === 'checking') {
      actions = [
        <Button key="cancel" onClick={closeModal}>
          {t('cancel', { ns: 'common' })}
        </Button>,
      ];
    }

    if (stage === 'available') {
      actions = [
        <Button key="cancel" onClick={closeModal}>
          {t('cancel', { ns: 'common' })}
        </Button>,
        <Button key="download" type="primary" onClick={handleDownload}>
          {t('updater.downloadNewVersion')}
        </Button>,
      ];
    }

    if (stage === 'downloaded') {
      actions = [
        <Button key="later" onClick={handleInstallLater}>
          {t('updater.installLater')}
        </Button>,
        <Button key="now" type="primary" onClick={handleInstallNow}>
          {t('updater.restartAndInstall')}
        </Button>,
      ];
    }

    if (stage === 'latest') {
      actions = [
        <Button key="ok" type="primary" onClick={closeModal}>
          {t('ok', { ns: 'common' })}
        </Button>,
      ];
    }

    if (actions.length === 0) return null;

    return (
      <Flexbox horizontal gap={8} justify="end">
        {actions}
      </Flexbox>
    );
  };

  return (
    <Flexbox gap={16} style={{ padding: 16 }}>
      <div>{renderBody()}</div>
      {renderActions()}
    </Flexbox>
  );
});

UpdateModalContent.displayName = 'UpdateModalContent';

interface UpdateModalOpenProps {
  onAfterClose?: () => void;
}

export const useUpdateModal = () => {
  const instanceRef = useRef<ModalInstance | null>(null);

  const open = useCallback((props?: UpdateModalOpenProps) => {
    const setModalProps = (nextProps: ModalUpdateOptions) => {
      instanceRef.current?.update?.(nextProps);
    };

    const handleClose = () => {
      instanceRef.current?.close();
    };

    instanceRef.current = createModal({
      afterClose: props?.onAfterClose,
      children: <UpdateModalContent setModalProps={setModalProps} onClose={handleClose} />,
      footer: null,
      keyboard: true,
      maskClosable: true,
      title: '',
    });
  }, []);

  return { open };
};
