'use client';

import { Button } from 'antd';
import { createStaticStyles } from 'antd-style';
import { AnimatePresence, m } from 'motion/react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    pointer-events: none;

    position: fixed;
    z-index: 1000;
    inset-block-end: 24px;
    inset-inline-start: 50%;
    transform: translateX(-50%);
  `,
  pill: css`
    pointer-events: auto;

    display: inline-flex;
    gap: 8px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 16px 6px;
    border-radius: 999px;

    font-size: 13px;
    color: ${cssVar.colorTextLightSolid};

    background: ${cssVar.colorBgSpotlight};
    box-shadow:
      0 8px 28px rgb(0 0 0 / 22%),
      0 2px 6px rgb(0 0 0 / 14%);
  `,
  dot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${cssVar.colorWarning};
  `,
  message: css`
    opacity: 0.92;
  `,
  resetButton: css`
    height: 28px;
    padding-block: 0;
    padding-inline: 12px;
    border-radius: 999px;

    color: rgb(255 255 255 / 85%);

    background: transparent;

    &:hover {
      color: #fff !important;
      background: rgb(255 255 255 / 8%) !important;
    }
  `,
  saveButton: css`
    height: 28px;
    padding-block: 0;
    padding-inline: 14px;
    border: none;
    border-radius: 999px;

    font-weight: 500;
    color: ${cssVar.colorBgSpotlight} !important;

    background: #fff !important;

    &:hover {
      background: rgb(255 255 255 / 92%) !important;
    }
  `,
}));

interface SaveBarProps {
  isDirty: boolean;
  isSaving: boolean;
  onReset: () => void;
  onSave: () => void;
}

const SaveBar = memo<SaveBarProps>(({ isDirty, isSaving, onReset, onSave }) => {
  const { t } = useTranslation('electron');

  return (
    <AnimatePresence>
      {isDirty && (
        <m.div
          animate={{ opacity: 1, y: 0 }}
          aria-live="polite"
          className={styles.container}
          exit={{ opacity: 0, y: 16 }}
          initial={{ opacity: 0, y: 16 }}
          role="status"
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <div className={styles.pill}>
            <span className={styles.dot} />
            <span className={styles.message}>{t('proxy.unsavedChanges')}</span>
            <Button
              className={styles.resetButton}
              disabled={isSaving}
              size="small"
              type="text"
              onClick={onReset}
            >
              {t('proxy.resetButton')}
            </Button>
            <Button
              className={styles.saveButton}
              loading={isSaving}
              size="small"
              type="primary"
              onClick={onSave}
            >
              {t('proxy.saveButton')}
            </Button>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
});

SaveBar.displayName = 'SaveBar';

export default SaveBar;
