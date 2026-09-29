'use client';

import { cssVar } from 'antd-style';
import { memo } from 'react';

import { sparklinePoints } from '../../utils/series';

const HEIGHT = 28;
const WIDTH = 100;

/** Shape-only trend line under a stat: no axes, the number above carries the value. */
const TrendSparkline = memo<{ values: number[] }>(({ values }) => {
  if (values.length < 2) return null;

  const points = sparklinePoints(values, WIDTH, HEIGHT);
  const d = points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');

  return (
    <svg
      aria-hidden
      data-widget-sparkline
      height={HEIGHT}
      preserveAspectRatio={'none'}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={'100%'}
    >
      <path
        d={d}
        fill={'none'}
        stroke={cssVar.colorPrimary}
        strokeWidth={1.5}
        vectorEffect={'non-scaling-stroke'}
      />
      {points.map(({ x, y }, index) => (
        <path
          d={`M ${x} ${y} l 0.0001 0`}
          key={index}
          stroke={cssVar.colorPrimary}
          strokeLinecap={'round'}
          strokeWidth={4}
          vectorEffect={'non-scaling-stroke'}
        />
      ))}
    </svg>
  );
});

TrendSparkline.displayName = 'DashboardTrendSparkline';

export default TrendSparkline;
