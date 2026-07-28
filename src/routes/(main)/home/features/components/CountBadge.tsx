import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  badge: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;

    min-width: 20px;
    height: 18px;
    padding-inline: 5px;
    border-radius: 5px;

    font-size: 12px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillTertiary};
  `,
}));

const CountBadge = memo<{ count: number }>(({ count }) => (
  <span className={styles.badge}>{count}</span>
));

export default CountBadge;
