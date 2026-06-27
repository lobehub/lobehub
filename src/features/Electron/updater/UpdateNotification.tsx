'use client';

import { type UpdateInfo, useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Icon } from '@lobehub/ui';
import { Button as BaseButton } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { CheckCircle2, CircleFadingArrowUp, X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePlatform } from '@/hooks/usePlatform';
import { autoUpdateService } from '@/services/electron/autoUpdate';

const MAC_CARD_RADIUS = 10;
const DEFAULT_CARD_RADIUS = 8;
const ENTER_EXIT_EASE = [0.16, 1, 0.3, 1] as const;

type ViewState = 'prompt' | 'confirming' | null;

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    pointer-events: auto;

    overflow: hidden;

    min-width: 360px;

    color: ${cssVar.colorText};

    background: color-mix(in srgb, ${cssVar.colorBgElevated} 85%, transparent);
    backdrop-filter: blur(20px) saturate(1.5);
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  closeButton: css`
    cursor: pointer;

    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 6px;

    color: ${cssVar.colorTextTertiary};

    background: transparent;

    transition:
      background 120ms ease,
      color 120ms ease;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  container: css`
    pointer-events: none;

    position: fixed;
    z-index: 1000;
    inset-block-end: 16px;
    inset-inline-start: 16px;
  `,
  confirmRow: css`
    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 12px;
  `,
  confirmSub: css`
    display: block;
    margin-block-start: 2px;
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  confirmText: css`
    flex: 1;
    font-size: 13px;
    line-height: 1.3;
    color: ${cssVar.colorText};
  `,
  iconAccent: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border-radius: 8px;

    color: ${cssVar.colorSuccess};

    background: color-mix(in srgb, ${cssVar.colorSuccess} 16%, transparent);
  `,
  iconNeutral: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border-radius: 8px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  labelStack: css`
    display: flex;
    flex: 1;
    flex-direction: column;
  `,
  promptActions: css`
    display: flex;
    gap: 4px;
    align-items: center;
  `,
  promptRow: css`
    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 12px;
  `,
  title: css`
    font-size: 13px;
    font-weight: 500;
    line-height: 1.2;
    color: ${cssVar.colorText};
  `,
  version: css`
    margin-block-start: 2px;

    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
    letter-spacing: -0.01em;
  `,
}));

export const UpdateNotification = memo(() => {
  const { t: tElectron } = useTranslation('electron');
  const { isMacOS } = usePlatform();

  const [view, setView] = useState<ViewState>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);

  useWatchBroadcast('updateDownloaded', (info: UpdateInfo) => {
    setUpdateInfo(info);
    setIsInstalling(false);
    setView('prompt');
  });

  useWatchBroadcast('updateWillInstallLater', () => {
    setView('confirming');
  });

  const cardRadius = isMacOS ? MAC_CARD_RADIUS : DEFAULT_CARD_RADIUS;

  const handleInstallLater = () => {
    autoUpdateService.installLater();
  };

  const handleInstallNow = () => {
    setIsInstalling(true);
    autoUpdateService.installNow();
  };

  const handleDismiss = () => {
    setView(null);
  };

  return (
    <AnimatePresence>
      {view !== null && (
        <m.div
          animate={{ opacity: 1, scale: 1, y: 0 }}
          aria-live="polite"
          className={styles.container}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.2, ease: ENTER_EXIT_EASE }}
        >
          <m.div layout className={styles.card} style={{ borderRadius: cardRadius }}>
            <AnimatePresence initial={false} mode="wait">
              {view === 'prompt' && (
                <m.div
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                  key="prompt"
                  transition={{ duration: 0.16 }}
                >
                  <div className={styles.promptRow}>
                    <div className={styles.iconNeutral}>
                      <Icon icon={CircleFadingArrowUp} style={{ fontSize: 16 }} />
                    </div>
                    <div className={styles.labelStack}>
                      <span className={styles.title}>{tElectron('updater.updateReady')}</span>
                      {updateInfo?.version && (
                        <span className={styles.version}>v{updateInfo.version}</span>
                      )}
                    </div>
                    <div className={styles.promptActions}>
                      <BaseButton size="small" onClick={handleInstallLater}>
                        {tElectron('updater.later')}
                      </BaseButton>
                      <BaseButton
                        loading={isInstalling}
                        size="small"
                        type="primary"
                        onClick={handleInstallNow}
                      >
                        {tElectron('updater.upgradeNow')}
                      </BaseButton>
                    </div>
                  </div>
                </m.div>
              )}
              {view === 'confirming' && (
                <m.div
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                  key="confirming"
                  transition={{ duration: 0.16 }}
                >
                  <div className={styles.confirmRow}>
                    <div className={styles.iconAccent}>
                      <Icon icon={CheckCircle2} style={{ fontSize: 16 }} />
                    </div>
                    <div className={styles.confirmText}>
                      {tElectron('updater.willInstallLater')}
                      {updateInfo?.version && (
                        <span className={styles.confirmSub}>v{updateInfo.version}</span>
                      )}
                    </div>
                    <button
                      aria-label="Dismiss"
                      className={styles.closeButton}
                      type="button"
                      onClick={handleDismiss}
                    >
                      <Icon icon={X} style={{ fontSize: 14 }} />
                    </button>
                  </div>
                </m.div>
              )}
            </AnimatePresence>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
});

UpdateNotification.displayName = 'UpdateNotification';
