'use client';

import { Button } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  container: {
    pointerEvents: 'none',
    position: 'fixed',
    zIndex: 1000,
    insetBlockEnd: '24px',
    insetInlineStart: '50%',
    transform: 'translateX(-50%)',
  },
  pill: {
    pointerEvents: 'auto',
    display: 'inline-flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '6px',
    paddingInlineStart: '16px',
    paddingInlineEnd: '6px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: `color-mix(in srgb, ${cssVar.colorBorderSecondary} 60%, transparent)`,
    borderRadius: '999px',
    fontSize: '13px',
    color: cssVar.colorText,
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgElevated} 85%, transparent)`,
    backgroundImage: 'none',
    backdropFilter: 'blur(16px) saturate(1.2)',
    boxShadow: cssVar.boxShadowSecondary,
  },
  dot: {
    flexShrink: 0,
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorWarning,
    backgroundImage: 'none',
  },
  message: {
    color: cssVar.colorTextSecondary,
  },
  resetButton: {
    height: '28px',
    paddingBlock: 0,
    paddingInline: '12px',
    borderRadius: '999px',
    color: {
      'default': `${cssVar.colorTextSecondary} !important`,
      ':hover': `${cssVar.colorText} !important`,
    },
    backgroundColor: {
      'default': 'transparent',
      ':hover': `${cssVar.colorFillSecondary} !important`,
    },
    backgroundImage: 'none',
  },
  saveButton: {
    height: '28px',
    paddingBlock: 0,
    paddingInline: '14px',
    borderRadius: '999px',
    fontWeight: 500,
  },
});

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
          className={stylex.props(styles.container).className}
          exit={{ opacity: 0, y: 16 }}
          initial={{ opacity: 0, y: 16 }}
          role="status"
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <div {...stylex.props(styles.pill)}>
            <span {...stylex.props(styles.dot)} />
            <span {...stylex.props(styles.message)}>{t('proxy.unsavedChanges')}</span>
            <Button
              className={stylex.props(styles.resetButton).className}
              disabled={isSaving}
              size="small"
              type="text"
              onClick={onReset}
            >
              {t('proxy.resetButton')}
            </Button>
            <Button
              className={stylex.props(styles.saveButton).className}
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
