import { describe, expect, it } from 'vitest';

import { buildSeriesChartData, sparklinePoints } from './series';

describe('buildSeriesChartData', () => {
  it('prefers the metric_points history over the latest sliding window', () => {
    const data = buildSeriesChartData(
      {
        series: [{ name: 'stars', points: [{ t: '2026-09-29T10:00:00Z', v: 12 }] }],
        type: 'series',
      },
      [
        {
          name: 'stars',
          points: [
            { observedAt: new Date('2026-09-29T08:00:00Z'), value: 10 },
            { observedAt: new Date('2026-09-29T09:00:00Z'), value: 11 },
            { observedAt: new Date('2026-09-29T10:00:00Z'), value: 12 },
          ],
        },
      ],
    );
    expect(data.fromHistory).toBe(true);
    expect(data.categories).toEqual(['stars']);
    expect(data.rows.map((row) => row.stars)).toEqual([10, 11, 12]);
  });

  it('falls back to the output for category labels the metrics cannot hold', () => {
    const data = buildSeriesChartData(
      {
        series: [
          {
            name: 'visits',
            points: [
              { t: 'Mon', v: 3 },
              { t: 'Tue', v: 5 },
            ],
          },
        ],
        type: 'series',
      },
      [],
    );
    expect(data.fromHistory).toBe(false);
    expect(data.rows).toEqual([
      { t: 'Mon', visits: 3 },
      { t: 'Tue', visits: 5 },
    ]);
  });

  it('merges several series on a shared, chronologically sorted axis', () => {
    const data = buildSeriesChartData({
      series: [
        { name: 'a', points: [{ t: '2026-09-29T10:00:00Z', v: 2 }] },
        {
          name: 'b',
          points: [
            { t: '2026-09-29T09:00:00Z', v: 1 },
            { t: '2026-09-29T10:00:00Z', v: 3 },
          ],
        },
      ],
      type: 'series',
    });
    expect(data.rows).toHaveLength(2);
    expect(data.rows[0]).not.toHaveProperty('a');
    expect(data.rows[1]).toMatchObject({ a: 2, b: 3 });
  });

  it('labels calendar-day points by day instead of midnight', () => {
    const data = buildSeriesChartData({
      series: [
        {
          name: 'commits',
          points: [
            { t: '2026-09-28', v: 55 },
            { t: '2026-09-27', v: 41 },
          ],
        },
      ],
      type: 'series',
    });
    expect(data.rows).toEqual([
      { commits: 41, t: '09-27' },
      { commits: 55, t: '09-28' },
    ]);
  });
});

describe('sparklinePoints', () => {
  it('spreads a changing history across the box', () => {
    expect(sparklinePoints([1, 3], 100, 28)).toEqual([
      { x: 0, y: 26 },
      { x: 100, y: 2 },
    ]);
  });

  it('draws a flat history mid-height instead of on the bottom edge', () => {
    expect(sparklinePoints([12, 12, 12], 100, 28).map(({ y }) => y)).toEqual([14, 14, 14]);
  });
});
