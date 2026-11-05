'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  segment: {
    height: '100%',
    transition: { 'default': 'width 0.3s ease', '@media (prefers-reduced-motion: reduce)': 'none' },
  },
  track: {
    overflow: 'hidden',
    display: 'flex',
    width: '100%',
    borderRadius: '999px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
});

interface SegmentBarProps {
  height?: number;
  /** Proportional segments rendered left→right; zero-value segments are skipped. */
  segments: { color: string; value: number }[];
}

/**
 * A single pill bar split into proportional colored segments — the shared way to
 * show an outcome breakdown (pass / fail / error, status distribution) at a glance
 * across the eval surfaces. Empty (all-zero) renders as a quiet track.
 */
const SegmentBar = memo<SegmentBarProps>(({ segments, height = 8 }) => {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className={stylex.props(styles.track).className} style={{ height }}>
      {total > 0 &&
        segments.map((s, i) =>
          s.value > 0 ? (
            <span
              className={stylex.props(styles.segment).className}
              key={i}
              style={{ background: s.color, width: `${(s.value / total) * 100}%` }}
            />
          ) : null,
        )}
    </div>
  );
});

export default SegmentBar;
