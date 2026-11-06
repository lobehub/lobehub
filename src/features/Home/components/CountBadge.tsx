import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { homeType } from './homeType';

const styles = stylex.create({
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '20px',
    height: '18px',
    paddingInline: '5px',
    borderRadius: '5px',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

const CountBadge = memo<{ count: number }>(({ count }) => (
  <span {...stylex.props(styles.badge, homeType.badge)}>{count}</span>
));

export default CountBadge;
