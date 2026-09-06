'use client';

import { cssVar } from 'antd-style';
import { memo } from 'react';

/**
 * Trend-only miniature: no axes, no labels — the card's number carries the
 * value, this carries the shape of the climb.
 */
const Sparkline = memo<{ met?: boolean; values: number[] }>(({ met, values }) => {
  const width = 84;
  const height = 22;
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-9, max - min);
  const sx = (index: number) => (index / (values.length - 1)) * (width - 2) + 1;
  const sy = (value: number) => height - 2 - ((value - min) / span) * (height - 4);
  const d = values
    .map((value, index) => `${index === 0 ? 'M' : 'L'} ${sx(index)} ${sy(value)}`)
    .join(' ');

  return (
    <svg aria-hidden height={height} width={width}>
      <path
        d={d}
        fill={'none'}
        stroke={met ? cssVar.colorSuccess : cssVar.colorInfo}
        strokeWidth={1.5}
      />
    </svg>
  );
});

Sparkline.displayName = 'NorthStarSparkline';

export default Sparkline;
