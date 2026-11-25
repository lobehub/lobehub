import { createStaticStyles, cx } from '@lobehub/ui';
import { memo } from 'react';

import { densityVars } from '@/styles/densityVars';

import { homeType } from './homeType';

const styles = createStaticStyles(({ css, cssVar }) => ({
  badge: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;

    min-width: ${densityVars.badgeMinWidth};
    height: ${densityVars.badgeHeight};
    padding-inline: 5px;
    border-radius: 5px;

    background: ${cssVar.colorFillTertiary};
  `,
}));

const CountBadge = memo<{ count: number }>(({ count }) => (
  <span className={cx(styles.badge, homeType.badge)}>{count}</span>
));

export default CountBadge;
