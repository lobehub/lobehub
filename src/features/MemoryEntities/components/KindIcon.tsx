import { Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { KIND_META, kindTint } from '../kinds';
import { type ContextKind } from '../types';

const styles = stylex.create({
  root: {
    alignItems: 'center',
    borderRadius: '6px',
    display: 'inline-flex',
    flexShrink: 0,
    justifyContent: 'center',
  },
  sm: { height: '24px', width: '24px' },
  lg: { borderRadius: '10px', height: '40px', width: '40px' },
});

interface KindIconProps {
  kind: ContextKind;
  size?: 'sm' | 'lg';
}

const KindIcon = memo<KindIconProps>(({ kind, size = 'sm' }) => (
  <span {...stylex.props(styles.root, styles[size], kindTint[kind])}>
    <Icon icon={KIND_META[kind].icon} size={size === 'lg' ? 20 : 14} />
  </span>
));

KindIcon.displayName = 'KindIcon';

export default KindIcon;
