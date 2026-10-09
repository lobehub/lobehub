import type { UpdateInfo } from '@lobechat/electron-client-ipc';
import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Flexbox, Icon, Markdown } from '@lobehub/ui';
import { Button as BaseButton, createModal, toast, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { t } from 'i18next';
import { X } from 'lucide-react';
import React, { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { autoUpdateService } from '@/services/electron/autoUpdate';
import { rendererOtaService } from '@/services/electron/rendererOta';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { applyCoreUpdate } from './applyCoreUpdate';
import { selectUpdateInfo } from './selectUpdateInfo';

const styles = createStaticStyles(({ css, cssVar }) => ({
  installLaterCloseButton: css`
    all: unset;

    cursor: pointer;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    inline-size: 24px;
    block-size: 24px;
    border-radius: 6px;

    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,

  installLaterToast: css`
    position: fixed;
    z-index: 1000;
    inset-block-end: 20px;
    inset-inline-start: 16px;

    display: flex;
    gap: 8px;
    align-items: center;

    max-inline-size: calc(100vw - 32px);
    padding-block: 8px;
    padding-inline: 12px 8px;
    border-radius: ${cssVar.borderRadiusLG};

    font-size: ${cssVar.fontSizeSM};
    line-height: 1.25;
    color: ${cssVar.colorText};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadow};
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
          onClick={() => {
            autoUpdateService.installLater();
            close();
          }}
        >
          {tElectron('updater.installLater')}
        </BaseButton>
        <BaseButton
          loading={isInstalling}
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
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [installConfirmMode, setInstallConfirmMode] = useState<
    'unconfirm' | 'installLater' | 'installNow' | null
  >('unconfirm');
  const [isInstalling, setIsInstalling] = useState(false);
  const [appliedVersion, setAppliedVersion] = useState<string | null>(null);
  const receivedUpdateEvent = useRef(false);
  useEffect(() => {
    let active = true;
    rendererOtaService
      .getStatus()
      .then((status) => {
        if (!active || receivedUpdateEvent.current) return;
        setAppliedVersion((version) => version ?? status.appliedVersion ?? null);
        if (status.staged && status.applyMode) {
          setUpdateInfo(
            (current) =>
              current ?? {
                kind: status.applyMode === 'relaunch' ? 'core-relaunch' : 'core-reload',
                version: status.staged!,
              },
          );
        }
      })
      .catch(console.error);
    return () => {
      active = false;
    };
  }, []);
  useWatchBroadcast('coreUpdateApplied', (version) => {
    receivedUpdateEvent.current = true;
    setAppliedVersion(version);
    setUpdateInfo((current) =>
      current?.version === version && current.kind !== 'app' ? null : current,
    );
    setIsInstalling(false);
  });
  useWatchBroadcast('coreUpdateDeferred', () => {
    setIsInstalling(false);
    toast.info(tElectron('updater.rendererUpdateDeferred'));
  });
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  useWatchBroadcast('updateReady', (info) => {
    receivedUpdateEvent.current = true;
    setUpdateInfo((current) => selectUpdateInfo(current, info));
    if (info.kind === 'app' || info.kind === 'core-relaunch') setInstallConfirmMode('unconfirm');
  });

  useWatchBroadcast('updateWillInstallLater', () => {
    setInstallConfirmMode('installLater');

    setTimeout(() => setInstallConfirmMode(null), 5000);
  });

  const applyCoreUpdateNow = async (keepLoadingOnSuccess: boolean) => {
    setIsInstalling(true);
    const applied = await applyCoreUpdate(() =>
      toast.error(tElectron('updater.rendererUpdateError')),
    );
    if (!applied || !keepLoadingOnSuccess) setIsInstalling(false);
  };

  if (updateInfo?.kind === 'renderer' || updateInfo?.kind === 'core-reload') {
    return (
      <div className={styles.installLaterToast}>
        <span>{tElectron('updater.rendererReady', { version: updateInfo.version })}</span>
        <BaseButton size={'small'} type={'text'} onClick={() => setUpdateInfo(null)}>
          {tElectron('updater.ignore')}
        </BaseButton>
        <BaseButton
          loading={isInstalling}
          size={'small'}
          type={'primary'}
          onClick={() => applyCoreUpdateNow(false)}
        >
          {tElectron('updater.upgradeNow')}
        </BaseButton>
      </div>
    );
  }

  if (updateInfo?.kind === 'core-relaunch') {
    return (
      <div className={styles.installLaterToast}>
        <span>
          {tElectron('updater.updateReady')}
          {isDevMode ? ` · ${updateInfo.version}` : ''}
        </span>
        <BaseButton size={'small'} type={'text'} onClick={() => setUpdateInfo(null)}>
          {tElectron('updater.later')}
        </BaseButton>
        <BaseButton
          loading={isInstalling}
          size={'small'}
          type={'primary'}
          onClick={() => applyCoreUpdateNow(true)}
        >
          {tElectron('updater.upgradeNow')}
        </BaseButton>
      </div>
    );
  }

  if (!updateInfo)
    return appliedVersion ? (
      <div className={styles.installLaterToast}>
        <span>{tElectron('updater.rendererUpdated', { version: appliedVersion })}</span>
        <BaseButton size={'small'} type={'text'} onClick={() => setAppliedVersion(null)}>
          {tElectron('updater.ignore')}
        </BaseButton>
      </div>
    ) : null;

  if (installConfirmMode === 'installLater') {
    return (
      <div className={styles.installLaterToast}>
        {tElectron('updater.willInstallLater')}
        <button
          aria-label="Close"
          className={styles.installLaterCloseButton}
          type="button"
          onClick={() => setInstallConfirmMode(null)}
        >
          <Icon icon={X} style={{ fontSize: 14 }} />
        </button>
      </div>
    );
  }

  if (installConfirmMode === 'unconfirm')
    return (
      <div className={styles.installLaterToast}>
        <span style={{ cursor: 'pointer' }} onClick={() => openUpdateDetailModal(updateInfo)}>
          {tElectron('updater.updateReady')}
          {isDevMode && updateInfo?.version ? ` · ${updateInfo.version}` : ''}
        </span>
        <BaseButton size={'small'} type={'text'} onClick={() => autoUpdateService.installLater()}>
          {tElectron('updater.later')}
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
          {tElectron('updater.upgradeNow')}
        </BaseButton>
      </div>
    );

  return null;
};
