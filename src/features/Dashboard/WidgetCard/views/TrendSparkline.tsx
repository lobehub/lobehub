'use client';

import { cssVar } from 'antd-style';
import { memo, useId } from 'react';

import { sparklinePoints } from '../../utils/series';

/** The first series color of `@lobehub/charts`, so a stat trend reads like the charts beside it. */
const COLOR = cssVar.geekblue;

const HEIGHT = 40;
const WIDTH = 100;

/**
 * Shape-only trend under a stat: no axes, the number above carries the value.
 * A soft area anchors the line to the card floor, and only the latest point is
 * marked — it is the one the number above reports.
 */
const TrendSparkline = memo<{ values: number[] }>(({ values }) => {
  const gradientId = useId();

  if (values.length < 2) return null;

  const points = sparklinePoints(values, WIDTH, HEIGHT);
  const line = points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  const area = `${line} L ${points.at(-1)!.x} ${HEIGHT} L ${points[0].x} ${HEIGHT} Z`;
  const last = points.at(-1)!;

  return (
    <svg
      aria-hidden
      data-widget-sparkline
      height={'100%'}
      preserveAspectRatio={'none'}
      style={{ display: 'block', minHeight: 28, overflow: 'visible' }}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={'100%'}
    >
      <defs>
        <linearGradient id={gradientId} x1={0} x2={0} y1={0} y2={1}>
          <stop offset={'0%'} stopColor={COLOR} stopOpacity={0.22} />
          <stop offset={'100%'} stopColor={COLOR} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} stroke={'none'} />
      <path
        d={line}
        fill={'none'}
        stroke={COLOR}
        strokeLinejoin={'round'}
        strokeWidth={1.75}
        vectorEffect={'non-scaling-stroke'}
      />
      <path
        d={`M ${last.x} ${last.y} l 0.0001 0`}
        stroke={cssVar.colorBgContainer}
        strokeLinecap={'round'}
        strokeWidth={9}
        vectorEffect={'non-scaling-stroke'}
      />
      <path
        data-sparkline-last
        d={`M ${last.x} ${last.y} l 0.0001 0`}
        stroke={COLOR}
        strokeLinecap={'round'}
        strokeWidth={5}
        vectorEffect={'non-scaling-stroke'}
      />
    </svg>
  );
});

TrendSparkline.displayName = 'DashboardTrendSparkline';

export default TrendSparkline;
