'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { LockIcon } from 'lucide-react';
import { memo } from 'react';

import LibIcon from './index';

const styles = stylex.create({
  badge: {
    position: 'absolute',
    insetBlockEnd: '-3px',
    insetInlineEnd: '-4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1px',
    borderRadius: '50%',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
  root: { position: 'relative', display: 'flex' },
});

interface LockedLibIconProps {
  size?: number;
}

/**
 * The shared "restricted library" visual: the library keeps its own icon
 * (it is shared workspace content), and a small corner lock says members
 * cannot open it. Use this everywhere a member-restricted KB renders an icon,
 * so the state reads the same across sidebar, cards, and pickers.
 */
const LockedLibIcon = memo<LockedLibIconProps>(({ size = 20 }) => (
  <span {...stylex.props(styles.root)}>
    <LibIcon size={size} />
    <span {...stylex.props(styles.badge)}>
      <Icon icon={LockIcon} size={Math.min(12, Math.round(size / 2))} />
    </span>
  </span>
));

export default LockedLibIcon;
