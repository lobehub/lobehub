'use client';

import { Text } from '@lobehub/ui';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';

import { SETTINGS_ANCHOR_ROW_ATTR, SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';

interface ProfileRowProps {
  action?: ReactNode;
  /** Settings-search anchor id; when set, the row becomes a scroll/highlight target */
  anchor?: string;
  children?: ReactNode;
  label?: string;
  labelSlot?: ReactNode;
}

const styles = stylex.create({
  action: {
    flexShrink: 0,
    // Keep action trailing even for action-only rows (AvatarRow / PasswordRow) where body has no children and space-between degenerates to flex-start.
    marginInlineStart: 'auto',
  },
  body: {
    display: 'flex',
    flex: '1',
    gap: '12px',
    alignItems: 'center',
    justifyContent: 'space-between',
    minWidth: '0',
  },
  label: { flexGrow: 0, flexShrink: 0, flexBasis: { default: '160px', [media.md]: 'auto' } },
  row: {
    display: 'flex',
    gap: { default: '24px', [media.md]: '12px' },
    alignItems: { default: 'center', [media.md]: 'stretch' },
    minHeight: '48px',
    paddingBlock: '16px',
    flexDirection: { default: null, [media.md]: 'column' },
  },
});

const ProfileRow = ({ anchor, label, labelSlot, children, action }: ProfileRowProps) => {
  const labelNode = labelSlot ?? (label && <Text strong>{label}</Text>);

  return (
    <div
      {...stylex.props(styles.row)}
      {...(anchor ? { [SETTINGS_ANCHOR_ROW_ATTR]: '' } : undefined)}
    >
      <div {...stylex.props(styles.label)}>
        {anchor ? <SettingsSearchAnchor id={anchor}>{labelNode}</SettingsSearchAnchor> : labelNode}
      </div>
      <div {...stylex.props(styles.body)}>
        {children}
        {action && <div {...stylex.props(styles.action)}>{action}</div>}
      </div>
    </div>
  );
};

export default ProfileRow;
