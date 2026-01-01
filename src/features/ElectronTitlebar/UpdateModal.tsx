import {
  type ProgressInfo,
  type UpdateInfo,
  useWatchBroadcast,
} from '@lobechat/electron-client-ipc';
import { Button } from '@lobehub/ui';
import { App, Modal, Progress, Spin } from 'antd';
import React, { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { autoUpdateService } from '@/services/electron/autoUpdate';
import { formatSpeed } from '@/utils/format';

export const UpdateModal = memo(() => {
  const { t } = useTranslation(['electron', 'common']);

  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  // 仅用于手动触发的更新流程（用户从设置页点“检查更新”）
  const manualFlowRef = useRef(false);
  const [updateAvailableInfo, setUpdateAvailableInfo] = useState<UpdateInfo | null>(null);
  const [downloadedInfo, setDownloadedInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [latestVersionInfo, setLatestVersionInfo] = useState<UpdateInfo | null>(null); // State for latest version modal
  const { modal } = App.useApp();
  // --- Event Listeners ---

  useWatchBroadcast('manualUpdateCheckStart', () => {
    console.log('[Manual Update] Check Start');
    manualFlowRef.current = true;

    setIsChecking(true);
    setUpdateAvailableInfo(null);
    setDownloadedInfo(null);
    setProgress(null);
    setLatestVersionInfo(null); // Reset latest version info
    // Optional: Show a brief notification that check has started
    // notification.info({ message: t('updater.checking') });
  });

  useWatchBroadcast('manualUpdateAvailable', (info: UpdateInfo) => {
    console.log('[Manual Update] Available:', info);
    // Only react if it's part of a manual check flow (i.e., isChecking was true)
    // No need to check isChecking here as this event is specific
    setIsChecking(false);
    setUpdateAvailableInfo(info);
  });

  useWatchBroadcast('manualUpdateNotAvailable', (info) => {
    console.log('[Manual Update] Not Available:', info);
    // Only react if it's part of a manual check flow
    // No need to check isChecking here as this event is specific
    setIsChecking(false);
    manualFlowRef.current = false;

    setLatestVersionInfo(info); // Set info for the modal
    // notification.success({
    //   description: t('updater.isLatestVersionDesc', { version: info.version }),
    //   message: t('updater.isLatestVersion'),
    // });
  });

  useWatchBroadcast('updateError', (message: string) => {
    console.log('[Manual Update] Error:', message);
    // Only react if it's part of a manual check/download flow
    if (isChecking || isDownloading) {
      setIsChecking(false);
      setIsDownloading(false);
      // Show error modal or notification
      modal.error({ content: message, title: t('updater.updateError') });
      setLatestVersionInfo(null); // Ensure other modals are closed on error
      setUpdateAvailableInfo(null);
      setDownloadedInfo(null);
      manualFlowRef.current = false;
    }
  });

  useWatchBroadcast('updateDownloadStart', () => {
    console.log('[Manual Update] Download Start');
    // This event implies a manual download was triggered (likely from the 'updateAvailable' modal)
    manualFlowRef.current = true;

    setIsDownloading(true);
    setUpdateAvailableInfo(null); // Hide the 'download' button modal
    setProgress({ bytesPerSecond: 0, percent: 0, total: 0, transferred: 0 }); // Reset progress
    setLatestVersionInfo(null); // Ensure other modals are closed
    // Optional: Show notification that download started
    // notification.info({ message: t('updater.downloadingUpdate') });
  });

  useWatchBroadcast('updateDownloadProgress', (progressInfo: ProgressInfo) => {
    console.log('[Manual Update] Progress:', progressInfo);
    // Only update progress if we are in the manual download state
    setProgress(progressInfo);
  });

  useWatchBroadcast('updateDownloaded', (info: UpdateInfo) => {
    console.log('[Manual Update] Downloaded:', info);
    // 仅在手动流程里展示阻塞式的“更新就绪”弹窗
    if (manualFlowRef.current) {
      setIsChecking(false);
      setIsDownloading(false);
      setDownloadedInfo(info);
      setProgress(null); // Clear progress
      setLatestVersionInfo(null); // Ensure other modals are closed
      setUpdateAvailableInfo(null);
    }
  });

  // --- Render Logic ---

  const handleDownload = () => {
    if (!updateAvailableInfo) return;
    // No need to set states here, 'updateDownloadStart' will handle it
    autoUpdateService.downloadUpdate();
  };

  const handleInstallNow = () => {
    setDownloadedInfo(null); // Close modal immediately
    autoUpdateService.installNow();
    manualFlowRef.current = false;
  };

  const handleInstallLater = () => {
    // No need to set state here, 'updateWillInstallLater' handles it
    autoUpdateService.installLater();
    setDownloadedInfo(null); // Close the modal after clicking
    manualFlowRef.current = false;
  };

  const closeAvailableModal = () => setUpdateAvailableInfo(null);
  const closeDownloadedModal = () => setDownloadedInfo(null);
  const closeLatestVersionModal = () => setLatestVersionInfo(null);

  const handleCancelCheck = () => {
    setIsChecking(false);
    setUpdateAvailableInfo(null);
    setDownloadedInfo(null);
    setProgress(null);
    setLatestVersionInfo(null);
    manualFlowRef.current = false;
  };

  const renderCheckingModal = () => (
    <Modal
      closable
      footer={[
        <Button key="cancel" onClick={handleCancelCheck}>
          {t('cancel', { ns: 'common' })}
        </Button>,
      ]}
      onCancel={handleCancelCheck}
      open={isChecking}
      title={t('updater.checkingUpdate')}
    >
      <Spin spinning={true}>
        <div style={{ padding: '20px', textAlign: 'center' }}>
          {t('updater.checkingUpdateDesc')}
        </div>
      </Spin>
    </Modal>
  );

  const renderAvailableModal = () => (
    <Modal
      footer={[
        <Button key="cancel" onClick={closeAvailableModal}>
          {t('cancel', { ns: 'common' })}
        </Button>,
        <Button key="download" onClick={handleDownload} type="primary">
          {t('updater.downloadNewVersion')}
        </Button>,
      ]}
      onCancel={closeAvailableModal}
      open={!!updateAvailableInfo}
      title={t('updater.newVersionAvailable')}
    >
      <h4>{t('updater.newVersionAvailableDesc', { version: updateAvailableInfo?.version })}</h4>
      {updateAvailableInfo?.releaseNotes && (
        <div
          dangerouslySetInnerHTML={{ __html: updateAvailableInfo.releaseNotes as string }}
          style={{
            // background:theme
            borderRadius: 4,
            marginTop: 8,
            maxHeight: 300,
            overflow: 'auto',
            padding: '8px 12px',
          }}
        />
      )}
    </Modal>
  );

  const renderDownloadingModal = () => {
    const percent = progress ? Math.round(progress.percent) : 0;
    return (
      <Modal
        closable={false}
        footer={null}
        maskClosable={false}
        open={isDownloading && !downloadedInfo}
        title={t('updater.downloadingUpdate')}
      >
        <div style={{ padding: '20px 0' }}>
          <Progress percent={percent} status="active" />
          <div style={{ fontSize: 12, marginTop: 8, textAlign: 'center' }}>
            {t('updater.downloadingUpdateDesc', { percent })}
            {progress && progress.bytesPerSecond > 0 && (
              <span>{formatSpeed(progress.bytesPerSecond)}</span>
            )}
          </div>
        </div>
      </Modal>
    );
  };

  const renderDownloadedModal = () => (
    <Modal
      footer={[
        <Button key="later" onClick={handleInstallLater}>
          {t('updater.installLater')}
        </Button>,
        <Button key="now" onClick={handleInstallNow} type="primary">
          {t('updater.restartAndInstall')}
        </Button>,
      ]}
      onCancel={closeDownloadedModal} // Allow closing if they don't want to decide now
      open={!!downloadedInfo}
      title={t('updater.updateReady')}
    >
      <h4>{t('updater.updateReadyDesc', { version: downloadedInfo?.version })}</h4>
      {downloadedInfo?.releaseNotes && (
        <div
          dangerouslySetInnerHTML={{ __html: downloadedInfo.releaseNotes as string }}
          style={{
            borderRadius: 4,
            marginTop: 8,
            maxHeight: 300,
            overflow: 'auto',
            padding: '8px 12px',
          }}
        />
      )}
    </Modal>
  );

  // New modal for "latest version"
  const renderLatestVersionModal = () => (
    <Modal
      footer={[
        <Button key="ok" onClick={closeLatestVersionModal} type="primary">
          {t('ok', { ns: 'common' })}
        </Button>,
      ]}
      onCancel={closeLatestVersionModal}
      open={!!latestVersionInfo}
      title={t('updater.isLatestVersion')}
    >
      <p>{t('updater.isLatestVersionDesc', { version: latestVersionInfo?.version })}</p>
    </Modal>
  );

  return (
    <>
      {renderCheckingModal()}
      {renderAvailableModal()}
      {renderDownloadingModal()}
      {renderDownloadedModal()}
      {renderLatestVersionModal()}
      {/* Error state is handled by Modal.error currently */}
    </>
  );
});
