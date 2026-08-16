import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import type { ReactNode } from 'react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  `,
  confirm: css`
    display: flex;
    flex-direction: column;
    gap: 10px;

    max-width: 260px;
    padding-block: 8px;
    padding-inline: 10px;
  `,
  text: css`
    font-size: 13px;
    line-height: 1.5;
    color: ${cssVar.colorText};
  `,
}));

interface SkillDeleteConfirmProps {
  disabled?: boolean;
  displayName: string;
  onDelete: () => Promise<void> | void;
  onDone: () => void;
  renderTrigger: (onStart: () => void) => ReactNode;
}

/**
 * Confirms in place, inside the policy panel, rather than through the global
 * modal host: a modal there is a separate floating layer, and base-ui reads a
 * press on it as an outside press that dismisses the menu the user is still
 * working in.
 */
const SkillDeleteConfirm = memo<SkillDeleteConfirmProps>(
  ({ disabled, displayName, onDelete, onDone, renderTrigger }) => {
    const { t } = useTranslation('setting');
    const { t: tCommon } = useTranslation('common');
    const [confirming, setConfirming] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleConfirm = useCallback(async () => {
      setLoading(true);
      try {
        await onDelete();
      } finally {
        setLoading(false);
      }
      onDone();
    }, [onDelete, onDone]);

    if (!confirming) return renderTrigger(() => setConfirming(true));

    return (
      <div className={cx(styles.confirm)}>
        <span className={cx(styles.text)}>
          {t('tools.builtins.uninstallConfirm.desc', { name: displayName })}
        </span>
        <div className={cx(styles.actions)}>
          <Button disabled={loading} size="small" onClick={() => setConfirming(false)}>
            {tCommon('cancel')}
          </Button>
          <Button
            danger
            disabled={disabled}
            loading={loading}
            size="small"
            type="primary"
            onClick={handleConfirm}
          >
            {t('tools.builtins.uninstall')}
          </Button>
        </div>
      </div>
    );
  },
);

SkillDeleteConfirm.displayName = 'SkillDeleteConfirm';

export default SkillDeleteConfirm;
