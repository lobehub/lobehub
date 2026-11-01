import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const rippleAnim = stylex.keyframes({
  '0%': { opacity: 0.7, transform: 'scale(1)' },
  '100%': { opacity: 0, transform: 'scale(3)' },
});

const styles = stylex.create({
  dot: {
    position: 'relative',
    zIndex: 1,
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorInfo,
    backgroundImage: 'none',
  },
  ripple: {
    position: 'absolute',
    inset: 0,
    width: '6px',
    height: '6px',
    margin: 'auto',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorInfo,
    borderRadius: '50%',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    animationName: rippleAnim,
    animationDuration: '1.8s',
    animationTimingFunction: 'ease-out',
    animationIterationCount: 'infinite',
  },
  wrapper: {
    position: 'relative',
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '14px',
    height: '14px',
  },
});

interface UnreadDotProps {
  /** Announces the mark to screen readers — pass it wherever the dot is the only carrier of "unread". */
  label?: string;
}

/**
 * The unread mark for a completed run the user hasn't opened: a live rippling
 * dot rather than a static glyph, so "there's something new here" reads at a
 * glance in a long list. `ExecutionStatus`'s `unread` icon is only the fallback
 * for surfaces that can't render this.
 */
const UnreadDot = memo<UnreadDotProps>(({ label }) => (
  <span
    aria-label={label}
    data-testid="topic-unread-dot"
    role={label ? 'status' : undefined}
    {...stylex.props(styles.wrapper)}
  >
    <span {...stylex.props(styles.ripple)} />
    <span {...stylex.props(styles.dot)} />
  </span>
));

export default UnreadDot;
