'use client';

import { type UpdateInfo, useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Icon } from '@lobehub/ui';
import { Button as BaseButton } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { CheckCircle2, CircleFadingArrowUp, X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePlatform } from '@/hooks/usePlatform';
import { autoUpdateService } from '@/services/electron/autoUpdate';
import { useGlobalStore } from '@/store/global';
import type { GlobalState } from '@/store/global/initialState';
import { NAV_PANEL_MIN_WIDTH, systemStatusSelectors } from '@/store/global/selectors';

const MAC_CARD_RADIUS = 10;
const DEFAULT_CARD_RADIUS = 8;
const ENTER_EXIT_EASE = [0.16, 1, 0.3, 1] as const;
const STATE_TRANSITION_EASE = [0.22, 1, 0.36, 1] as const;
const NOTIFICATION_INLINE_OFFSET = 16;
const PROMPT_FRAME_HEIGHT = 88;
const CONFIRM_FRAME_HEIGHT = 56;

const DEV_MOCK_UPDATE_INFO: UpdateInfo = {
  releaseDate: new Date().toISOString(),
  version: '9.9.9-dev-mock-width-check',
};

type ViewState = 'prompt' | 'confirming' | null;

const notificationWidthSelector = (s: GlobalState): number => {
  const sidebarWidth = systemStatusSelectors.showLeftPanel(s)
    ? systemStatusSelectors.leftPanelWidth(s)
    : NAV_PANEL_MIN_WIDTH;

  return sidebarWidth - NOTIFICATION_INLINE_OFFSET * 2;
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    pointer-events: auto;

    overflow: hidden;

    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: 100%;

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgElevated};
    backdrop-filter: none;
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
    inset-block-end: ${NOTIFICATION_INLINE_OFFSET}px;
    inset-inline-start: ${NOTIFICATION_INLINE_OFFSET}px;
  `,
  confirmRow: css`
    display: flex;
    gap: 8px;
    align-items: center;

    box-sizing: border-box;
    height: 100%;
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
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 13px;
    line-height: 1.3;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
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
    gap: 2px;
    align-items: flex-start;

    min-width: 0;
  `,
  promptActions: css`
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: flex-end;

    width: 100%;

    > button {
      min-width: 0;
      max-width: 50%;
      white-space: nowrap;
    }

    > button > span {
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `,
  promptHeader: css`
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  `,
  promptRow: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: stretch;

    box-sizing: border-box;
    height: 100%;
    padding-block: 10px;
    padding-inline: 12px;
  `,
  stateFrame: css`
    position: relative;
    height: ${PROMPT_FRAME_HEIGHT}px;
    transition: height 180ms ${cssVar.motionEaseOut};

    &[data-view='confirming'] {
      height: ${CONFIRM_FRAME_HEIGHT}px;
    }
  `,
  statePanel: css`
    position: absolute;
    inset: 0;
  `,
  title: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 500;
    line-height: 1.2;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  version: css`
    overflow: hidden;

    max-width: 100%;

    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    letter-spacing: 0;
    white-space: nowrap;
  `,
}));

export const UpdateNotification = memo(() => {
  const { t: tElectron } = useTranslation('electron');
  const { isMacOS } = usePlatform();
  const notificationWidth = useGlobalStore(notificationWidthSelector);

  const [view, setView] = useState<ViewState>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isMockUpdate, setIsMockUpdate] = useState(false);

  useEffect(() => {
    if (!__DEV__) return;

    setUpdateInfo(DEV_MOCK_UPDATE_INFO);
    setIsInstalling(false);
    setIsMockUpdate(true);
    setView('prompt');
  }, []);

  useWatchBroadcast('updateDownloaded', (info: UpdateInfo) => {
    setUpdateInfo(info);
    setIsInstalling(false);
    setIsMockUpdate(false);
    setView('prompt');
  });

  useWatchBroadcast('updateWillInstallLater', () => {
    setView('confirming');
  });

  const cardRadius = isMacOS ? MAC_CARD_RADIUS : DEFAULT_CARD_RADIUS;

  const handleInstallLater = () => {
    if (isMockUpdate) {
      setView('confirming');
      return;
    }

    autoUpdateService.installLater();
  };

  const handleInstallNow = () => {
    if (isMockUpdate) {
      setView('confirming');
      return;
    }

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
          style={{ width: notificationWidth }}
          transition={{ duration: 0.2, ease: ENTER_EXIT_EASE }}
        >
          <m.div className={styles.card} style={{ borderRadius: cardRadius }}>
            <div className={styles.stateFrame} data-view={view}>
              <AnimatePresence initial={false}>
                {view === 'prompt' && (
                  <m.div
                    animate={{ opacity: 1, y: 0 }}
                    className={styles.statePanel}
                    exit={{ opacity: 0, y: -4 }}
                    initial={{ opacity: 0, y: 4 }}
                    key="prompt"
                    transition={{ duration: 0.18, ease: STATE_TRANSITION_EASE }}
                  >
                    <div className={styles.promptRow}>
                      <div className={styles.promptHeader}>
                        <div className={styles.iconNeutral}>
                          <Icon icon={CircleFadingArrowUp} style={{ fontSize: 16 }} />
                        </div>
                        <div className={styles.labelStack}>
                          <span className={styles.title}>{tElectron('updater.updateReady')}</span>
                          {updateInfo?.version && (
                            <span className={styles.version}>v{updateInfo.version}</span>
                          )}
                        </div>
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
                    animate={{ opacity: 1, y: 0 }}
                    className={styles.statePanel}
                    exit={{ opacity: 0, y: -4 }}
                    initial={{ opacity: 0, y: 4 }}
                    key="confirming"
                    transition={{ duration: 0.18, ease: STATE_TRANSITION_EASE }}
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
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
});

UpdateNotification.displayName = 'UpdateNotification';
