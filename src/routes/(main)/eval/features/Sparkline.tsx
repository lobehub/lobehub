'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  bar: {
    transition: {
      'default': 'height 0.2s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
});

interface SparklineProps {
  /** Highest-index value is the most recent run. */
  values: number[];
  width?: number;
}

/**
 * Pass-rate trend across a benchmark's recent runs — a compact at-a-glance read
 * of whether quality is climbing. Values are 0..1; the latest run is drawn in the
 * primary color, earlier runs in a muted success fill.
 */
const Sparkline = memo<SparklineProps>(({ values, width = 132 }) => {
  const height = 40;
  const gap = 4;
  const n = values.length;
  const barWidth = Math.max(3, (width - (n - 1) * gap) / n);

  return (
    <svg height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
      {values.map((v, i) => {
        const clamped = Math.max(0, Math.min(1, v));
        const barHeight = Math.max(3, clamped * height);
        const isLatest = i === n - 1;
        return (
          <rect
            {...stylex.props(styles.bar)}
            fill={isLatest ? cssVar.colorPrimary : cssVar.colorSuccess}
            height={barHeight}
            key={i}
            opacity={isLatest ? 1 : 0.45}
            rx={2}
            width={barWidth}
            x={i * (barWidth + gap)}
            y={height - barHeight}
          />
        );
      })}
    </svg>
  );
});

export default Sparkline;
