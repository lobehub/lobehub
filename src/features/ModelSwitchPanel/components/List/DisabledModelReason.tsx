import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { LockIcon } from 'lucide-react';
import { memo } from 'react';

const styles = stylex.create({
  icon: { display: 'flex', flex: 'none', alignItems: 'center', height: '20px' },
  reason: {
    display: 'flex',
    gap: '8px',
    marginBlockStart: '8px',
    marginBlockEnd: '0',
    marginInline: '8px',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadius,
    fontSize: '13px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
  },
});

/**
 * Why a dimmed model in the switch panel cannot be picked, shown at the top of its
 * hover panel. There is no action here: the business layer only disables a model the
 * viewer cannot unlock themselves, so the reason names who can.
 */
export const DisabledModelReason = memo<{ reason: string }>(({ reason }) => (
  <div role={'note'} {...stylex.props(styles.reason)}>
    <span {...stylex.props(styles.icon)}>
      <Icon icon={LockIcon} size={14} />
    </span>
    <span>{reason}</span>
  </div>
));

DisabledModelReason.displayName = 'DisabledModelReason';
