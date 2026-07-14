'use client';

import { Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
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

const styles = createStaticStyles(({ css, responsive }) => ({
  action: css`
    flex-shrink: 0;

    /* Keep action trailing even for action-only rows (AvatarRow / PasswordRow) where body has no children and space-between degenerates to flex-start. */
    margin-inline-start: auto;
  `,
  body: css`
    display: flex;
    flex: 1;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    min-width: 0;
  `,
  label: css`
    flex: 0 0 160px;

    ${responsive.md} {
      flex: 0 0 auto;
    }
  `,
  row: css`
    display: flex;
    gap: 24px;
    align-items: center;

    min-height: 48px;
    padding-block: 16px;

    ${responsive.md} {
      flex-direction: column;
      gap: 12px;
      align-items: stretch;
    }
  `,
}));

const ProfileRow = ({ anchor, label, labelSlot, children, action }: ProfileRowProps) => {
  const labelNode = labelSlot ?? (label && <Text strong>{label}</Text>);

  return (
    <div className={styles.row} {...(anchor ? { [SETTINGS_ANCHOR_ROW_ATTR]: '' } : undefined)}>
      <div className={styles.label}>
        {anchor ? <SettingsSearchAnchor id={anchor}>{labelNode}</SettingsSearchAnchor> : labelNode}
      </div>
      <div className={styles.body}>
        {children}
        {action && <div className={styles.action}>{action}</div>}
      </div>
    </div>
  );
};

export default ProfileRow;
