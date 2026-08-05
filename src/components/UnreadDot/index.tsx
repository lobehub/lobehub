import { createStaticStyles, keyframes } from 'antd-style';
import { memo } from 'react';

const rippleAnim = keyframes`
  0% {
    transform: scale(1);
    opacity: 0.7;
  }
  100% {
    transform: scale(3);
    opacity: 0;
  }
`;

const styles = createStaticStyles(({ css, cssVar }) => ({
  dot: css`
    position: relative;
    z-index: 1;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorInfo};
  `,
  ripple: css`
    position: absolute;
    inset: 0;

    width: 6px;
    height: 6px;
    margin: auto;
    border: 1px solid ${cssVar.colorInfo};
    border-radius: 50%;

    background: transparent;

    animation: ${rippleAnim} 1.8s ease-out infinite;
  `,
  wrapper: css`
    position: relative;

    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 14px;
    height: 14px;
  `,
}));

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
    className={styles.wrapper}
    data-testid="topic-unread-dot"
    role={label ? 'status' : undefined}
  >
    <span className={styles.ripple} />
    <span className={styles.dot} />
  </span>
));

export default UnreadDot;
