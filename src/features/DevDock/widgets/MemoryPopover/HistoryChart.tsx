'use client';

import { cssVar } from 'antd-style';
import { memo } from 'react';

import { formatCompactSize } from '../memoryFormat';
import { MAX_HISTORY, type MemorySample } from '../memorySamples';
import { styles } from './styles';

const HEIGHT = 72;
const WIDTH = 600;

interface Series {
  color: string;
  label: string;
  read: (sample: MemorySample) => number | null;
}

const SERIES: Series[] = [
  { color: cssVar.colorInfo, label: 'private', read: (s) => s.renderer?.privateBytes ?? null },
  { color: cssVar.colorSuccess, label: 'JS heap', read: (s) => s.jsHeapUsedBytes },
];

const pathFor = (values: (number | null)[], max: number) => {
  const sx = (index: number) => (index / Math.max(1, values.length - 1)) * WIDTH;
  const sy = (value: number) => HEIGHT - 1 - (value / max) * (HEIGHT - 2);
  let d = '';
  for (const [index, value] of values.entries()) {
    if (value === null) continue;
    d += `${d ? 'L' : 'M'}${sx(index).toFixed(1)} ${sy(value).toFixed(1)} `;
  }
  return d;
};

const HistoryChart = memo<{ history: MemorySample[] }>(({ history }) => {
  const series = SERIES.map((item) => ({ ...item, values: history.map(item.read) })).filter(
    (item) => item.values.some((value) => value !== null),
  );
  const max = Math.max(1, ...series.flatMap((item) => item.values.map((v) => v ?? 0)));
  const spanSeconds = history.length > 1 ? (history.at(-1)!.at - history[0].at) / 1000 : 0;

  return (
    <div style={{ borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`, flexShrink: 0 }}>
      <svg
        aria-hidden
        height={HEIGHT}
        preserveAspectRatio={'none'}
        style={{ display: 'block', paddingInline: 12, width: '100%' }}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        {series.map((item) => (
          <path
            d={pathFor(item.values, max)}
            fill={'none'}
            key={item.label}
            stroke={item.color}
            strokeWidth={1.5}
            vectorEffect={'non-scaling-stroke'}
          />
        ))}
      </svg>
      <div className={styles.caption} style={{ display: 'flex', gap: 12 }}>
        {series.map((item) => (
          <span key={item.label} style={{ color: item.color }}>
            ● {item.label} {formatCompactSize(item.values.at(-1) ?? 0)}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <span>
          top {formatCompactSize(max)} · last {Math.round(spanSeconds)}s of {MAX_HISTORY * 2}s
        </span>
      </div>
    </div>
  );
});

HistoryChart.displayName = 'DevMemoryHistoryChart';

export default HistoryChart;
