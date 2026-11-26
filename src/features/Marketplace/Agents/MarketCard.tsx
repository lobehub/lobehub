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

/** Every content block on a Marketplace Agent page (featured picks, skills, information): a Surface. */
const MarketCard = memo<{
  children: ReactNode;
  gap?: number;
  onClick?: () => void;
  onHoverChange?: (hovered: boolean) => void;
}>(({ children, gap = 12, onClick, onHoverChange }) => (
  <Surface
    style={onClick ? { cursor: 'pointer' } : undefined}
    onClick={onClick}
    onMouseEnter={onHoverChange && (() => onHoverChange(true))}
    onMouseLeave={onHoverChange && (() => onHoverChange(false))}
  >
    <div {...stylex.props(styles.body(gap))}>{children}</div>
  </Surface>
));

MarketCard.displayName = 'MarketplaceAgentCard';

export default MarketCard;
