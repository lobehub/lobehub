'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { LockIcon } from 'lucide-react';
import { memo } from 'react';

import LibIcon from './index';

const styles = createStaticStyles(({ css }) => ({
  // The plate under the lock keeps it legible over the folder strokes.
  badge: css`
    position: absolute;
    inset-block-end: -3px;
    inset-inline-end: -4px;

    display: flex;
    align-items: center;
    justify-content: center;

    padding: 1px;
    border-radius: 50%;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgLayout};
  `,
  root: css`
    position: relative;
    display: flex;
  `,
}));

interface LockedLibIconProps {
  size?: number;
}

/**
 * The shared "restricted library" visual: the library keeps its folder icon
 * (it is shared workspace content), and a small corner lock says members
 * cannot open it. Use this everywhere a member-restricted KB renders an icon,
 * so the state reads the same across sidebar, cards, and pickers.
 */
const LockedLibIcon = memo<LockedLibIconProps>(({ size = 20 }) => (
  <span className={styles.root}>
    <LibIcon size={size} />
    <span className={styles.badge}>
      <Icon icon={LockIcon} size={Math.min(12, Math.round(size / 2))} />
    </span>
  </span>
));

export default LockedLibIcon;
