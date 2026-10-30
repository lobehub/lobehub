import type { UpdateInfo } from '@lobechat/electron-client-ipc';
import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import {
  Button as BaseButton,
  createModal,
  Flexbox,
  Icon,
  Markdown,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t } from 'i18next';
import { X } from 'lucide-react';
import React, { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { autoUpdateService } from '@/services/electron/autoUpdate';
import { rendererOtaService } from '@/services/electron/rendererOta';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { applyCoreUpdate } from './applyCoreUpdate';
import { formatCoreVersion } from './coreVersion';
import { selectUpdateInfo } from './selectUpdateInfo';
import { useAutoDismiss } from './useAutoDismiss';

const APPLIED_TOAST_DURATION = 3000;

const styles = stylex.create({
  installLaterCloseButton: {
    all: 'unset',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    inlineSize: '24px',
    blockSize: '24px',
    borderRadius: '6px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  installLaterToast: {
    position: 'fixed',
    zIndex: 1000,
    insetBlockEnd: '20px',
    insetInlineStart: '16px',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    maxInlineSize: 'calc(100vw - 32px)',
    paddingBlock: '8px',
    paddingInlineStart: '12px',
    paddingInlineEnd: '8px',
    borderRadius: cssVar.borderRadiusLG,
    fontSize: cssVar.fontSizeSM,
    lineHeight: 1.25,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadow,
  },
  releaseNote: {
    overflow: 'scroll',
    maxHeight: '300px',
    padding: '8px',
    borderRadius: '8px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
});

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
          <div {...stylex.props(styles.releaseNote)}>
            <Markdown>{updateInfo.releaseNotes}</Markdown>
          </div>
        ) : (
          <div {...stylex.props(styles.releaseNote)}>
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

  // The "updated to version" toast only shows when no pending update takes its slot
  const appliedToastHoverHandlers = useAutoDismiss(
    updateInfo ? null : appliedVersion,
    () => setAppliedVersion(null),
    APPLIED_TOAST_DURATION,
  );

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
      <div {...stylex.props(styles.installLaterToast)}>
        <span>
          {tElectron('updater.rendererReady', { version: formatCoreVersion(updateInfo.version) })}
        </span>
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
      <div {...stylex.props(styles.installLaterToast)}>
        <span>
          {tElectron('updater.updateReady')}
          {isDevMode ? ` · ${formatCoreVersion(updateInfo.version)}` : ''}
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
      <div
        className={stylex.props(styles.installLaterToast).className}
        {...appliedToastHoverHandlers}
      >
        <span>
          {tElectron('updater.rendererUpdated', { version: formatCoreVersion(appliedVersion) })}
        </span>
        <BaseButton
          size={'small'}
          type={'text'}
          onClick={() => {
            setAppliedVersion(null);
            rendererOtaService.dismissAppliedNotice().catch(console.error);
          }}
        >
          {tElectron('updater.ignore')}
        </BaseButton>
      </div>
    ) : null;

  if (installConfirmMode === 'installLater') {
    return (
      <div {...stylex.props(styles.installLaterToast)}>
        {tElectron('updater.willInstallLater')}
        <button
          aria-label="Close"
          {...stylex.props(styles.installLaterCloseButton)}
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
      <div {...stylex.props(styles.installLaterToast)}>
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
