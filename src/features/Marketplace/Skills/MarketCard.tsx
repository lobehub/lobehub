import { Surface } from '@lobehub/ui/dashboard';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

const styles = stylex.create({
  body: (gap: number) => ({
    display: 'flex',
    flexDirection: 'column',
    gap,
    minWidth: 0,
    padding: 16,
  }),
});

/** Every content block on a Market page (account, info, repositories, reviews, SKILL.md): a Surface. */
const MarketCard = memo<{ children: ReactNode; gap?: number; onClick?: () => void }>(
  ({ children, gap = 12, onClick }) => (
    <Surface style={onClick ? { cursor: 'pointer' } : undefined} onClick={onClick}>
      <div {...stylex.props(styles.body(gap))}>{children}</div>
    </Surface>
  ),
);

MarketCard.displayName = 'MarketCard';

export default MarketCard;
