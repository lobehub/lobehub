import { Button, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  bar: {
    alignItems: 'center',
    backdropFilter: 'blur(16px) saturate(1.2)',
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgElevated} 88%, transparent)`,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: cssVar.boxShadowSecondary,
    display: 'flex',
    gap: 8,
    insetBlockEnd: 24,
    justifyContent: 'space-between',
    paddingBlock: 8,
    paddingInlineStart: '16px',
    paddingInlineEnd: '8px',
    position: 'sticky',
    zIndex: 10,
  },
  dot: {
    backgroundColor: cssVar.colorWarning,
    borderRadius: '50%',
    flexShrink: 0,
    height: 6,
    width: 6,
  },
  message: {
    alignItems: 'center',
    display: 'flex',
    gap: 8,
  },
});

interface SettingsSaveBarProps {
  count: number;
  disabled: boolean;
  onRevert: () => void;
  onSave: () => void;
  saving: boolean;
}

const SettingsSaveBar = ({ count, disabled, onRevert, onSave, saving }: SettingsSaveBarProps) => {
  const { t } = useTranslation(['project', 'common']);

  return (
    <AnimatePresence>
      {count > 0 && (
        <m.div
          animate={{ opacity: 1, y: 0 }}
          aria-live="polite"
          exit={{ opacity: 0, y: 12 }}
          initial={{ opacity: 0, y: 12 }}
          role="status"
          transition={{ duration: 0.18, ease: 'easeOut' }}
          {...stylex.props(styles.bar)}
        >
          <span {...stylex.props(styles.message)}>
            <span {...stylex.props(styles.dot)} />
            <Text fontSize={13} type="secondary">
              {t('settings.unsavedChanges', { count })}
            </Text>
          </span>
          <span {...stylex.props(styles.message)}>
            <Button disabled={saving} size="small" type="text" onClick={onRevert}>
              {t('settings.revert')}
            </Button>
            <Button
              disabled={disabled}
              loading={saving}
              size="small"
              type="primary"
              onClick={onSave}
            >
              {t('save', { ns: 'common' })}
            </Button>
          </span>
        </m.div>
      )}
    </AnimatePresence>
  );
};

export default SettingsSaveBar;
