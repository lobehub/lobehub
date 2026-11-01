import { describe, expect, it } from 'vitest';

import type { MetricSeriesWithPoints } from '@/services/metric';

import {
  buildNorthStarCards,
  buildNorthStarChartRows,
  buildObservationRows,
  deltaTone,
  formatMetricValue,
  NORTH_STAR_STALE_AFTER_MS,
} from './northStar';

const NOW = Date.parse('2026-09-06T12:00:00Z');

const series = (
  key: string,
  values: number[],
  overrides: Partial<MetricSeriesWithPoints> = {},
): MetricSeriesWithPoints => ({
  firstPoint:
    values.length > 0
      ? { observedAt: new Date(NOW - (values.length - 1) * 60_000), value: values[0] }
      : null,
  id: `mtr_${key}`,
  key,
  kind: 'gauge',
  points: values.map((value, index) => ({
    observedAt: new Date(NOW - (values.length - 1 - index) * 60_000),
    value,
  })),
  ...overrides,
});

describe('buildNorthStarCards', () => {
  it('normalizes a count-up clause from its first observation', () => {
    // 粉丝 42,180 → 目标 72,180，当前 57,180：爬了三万的一半。
    const [card] = buildNorthStarCards(
      [{ key: 'followers', target: 72_180 }],
      [series('followers', [42_180, 48_000, 57_180], { title: '粉丝总数' })],
      NOW,
    );

    expect(card).toMatchObject({ current: 57_180, label: '粉丝总数', met: false, op: 'gte' });
    expect(card.percent).toBeCloseTo(50);
  });

  it("prefers the clause's own display name over the series title and the key", () => {
    // Review r1: the key is the address, not the label — a declared display
    // name must win even when the series carries its own title.
    const [named, fallback] = buildNorthStarCards(
      [
        { key: 'followers', target: 1000, title: '粉丝总数' },
        { key: 'security.open_issues', op: 'lte', target: 0 },
      ],
      [series('followers', [500], { title: 'series title' })],
      NOW,
    );

    expect(named.label).toBe('粉丝总数');
    expect(fallback.label).toBe('security.open_issues');
  });

  it('reads a count-down clause in its own direction', () => {
    // 安全 issue 112 → 0，当前 37：清掉 67%，而不是「37/0」的除零。
    const [card] = buildNorthStarCards(
      [{ key: 'security.open_issues', op: 'lte', target: 0 }],
      [series('security.open_issues', [112, 80, 37])],
      NOW,
    );

    expect(card.met).toBe(false);
    expect(card.percent).toBeCloseTo(((112 - 37) / 112) * 100);
  });

  it('marks the clause met once the latest observation clears the target', () => {
    const [down, up] = buildNorthStarCards(
      [
        { key: 'issues', op: 'lte', target: 0 },
        { key: 'followers', target: 1000 },
      ],
      [series('issues', [112, 3, 0]), series('followers', [400, 1200])],
      NOW,
    );

    expect(down).toMatchObject({ met: true, percent: 100 });
    expect(up).toMatchObject({ met: true, percent: 100 });
  });

  it('treats a never-measured clause as unmeasured, not as zero progress toward done', () => {
    const [card] = buildNorthStarCards([{ key: 'followers', target: 1000 }], [], NOW);

    expect(card).toMatchObject({ current: null, label: 'followers', met: false, percent: 0 });
    expect(card.latestAt).toBeUndefined();
    expect(card.stale).toBe(false);
  });

  it('flags data older than the staleness window', () => {
    const old = {
      ...series('followers', [500]),
      points: [{ observedAt: new Date(NOW - NORTH_STAR_STALE_AFTER_MS - 1000), value: 500 }],
    };

    const [card] = buildNorthStarCards([{ key: 'followers', target: 1000 }], [old], NOW);

    expect(card.stale).toBe(true);
  });

  it('guards a baseline that already sits at the target', () => {
    // 起点即达标（span 0）：met 时 100，不达标时 0，永不除零。
    const [met] = buildNorthStarCards(
      [{ key: 'x', op: 'lte', target: 5 }],
      [series('x', [5, 5])],
      NOW,
    );
    expect(met).toMatchObject({ met: true, percent: 100 });
  });
});

describe('scale and windowing', () => {
  it('compares at the persisted numeric(20, 6) scale, matching the server gate', () => {
    // Recorded 0.1234567 reads back as 0.123457; a raw-target comparison
    // would keep this card unmet forever while the goal already advanced.
    const [card] = buildNorthStarCards(
      [{ key: 'precision', op: 'eq', target: 0.123_456_7 }],
      [series('precision', [0.123_457])],
      NOW,
    );

    expect(card.met).toBe(true);
  });

  it('takes the baseline from the true first observation, not the recent window', () => {
    // A 0 → 95 / 100 trajectory whose window only retains [90, 95] must read
    // 95%, not the 50% a window-rebased baseline would claim.
    const windowed = {
      ...series('long', [90, 95]),
      firstPoint: { observedAt: new Date(NOW - 10 * 86_400_000), value: 0 },
    };

    const [card] = buildNorthStarCards([{ key: 'long', target: 100 }], [windowed], NOW);

    expect(card.percent).toBeCloseTo(95);
  });
});

describe('formatMetricValue', () => {
  it('groups integers and passes fractions through', () => {
    expect(formatMetricValue(72_180)).toBe('72,180');
    expect(formatMetricValue(0.07)).toBe('0.07');
    expect(formatMetricValue(null)).toBe('—');
  });
});

describe('buildObservationRows', () => {
  it('lists observations newest first with the change from the one before', () => {
    const { points } = series('followers', [1000, 1040, 1080, 1120]);

    expect(buildObservationRows(points).map(({ delta, value }) => ({ delta, value }))).toEqual([
      { delta: 40, value: 1120 },
      { delta: 40, value: 1080 },
      { delta: 40, value: 1040 },
      { delta: null, value: 1000 },
    ]);
  });

  it('attaches each finished task to the first observation after it', () => {
    const { points } = series('followers', [1000, 1040, 1080]);
    const at = (index: number, offsetMs: number) =>
      new Date(points[index].observedAt.getTime() + offsetMs);
    const tasks = [
      { id: 'n_before', resolvedAt: at(0, -1000), title: 'Before the window' },
      { id: 'n_batch1', resolvedAt: at(1, -10_000), title: 'Batch 1' },
      { id: 'n_batch2', resolvedAt: at(2, 0), title: 'Batch 2' },
      { id: 'n_later', resolvedAt: at(2, 1000), title: 'Not measured yet' },
    ];

    expect(
      buildObservationRows(points, tasks).map((row) => row.tasks.map((task) => task.id)),
    ).toEqual([['n_batch2'], ['n_batch1'], ['n_before']]);
  });

  it('returns nothing for a series never measured', () => {
    expect(buildObservationRows([])).toEqual([]);
  });
});

describe('buildNorthStarChartRows', () => {
  it('pairs every observation with the flat target line', () => {
    const { points } = series('followers', [1000, 1080]);

    expect(buildNorthStarChartRows(points, 1100, (date) => date.toISOString())).toEqual([
      { target: 1100, time: points[0].observedAt.toISOString(), value: 1000 },
      { target: 1100, time: points[1].observedAt.toISOString(), value: 1080 },
    ]);
  });
});

describe('deltaTone', () => {
  it('reads an increase as progress on a count-up clause', () => {
    expect(deltaTone('gte', 1080, 40, 1100)).toBe('good');
    expect(deltaTone('gt', 1040, -40, 1100)).toBe('bad');
  });

  it('reads a decrease as progress on a lower-is-better clause', () => {
    // 未关闭 issue 112 → 目标 0：少了 12 个是进展，多了 5 个是倒退。
    expect(deltaTone('lte', 100, -12, 0)).toBe('good');
    expect(deltaTone('lt', 105, 5, 0)).toBe('bad');
  });

  it('judges an eq clause by whether the value moved toward the target', () => {
    expect(deltaTone('eq', 95, -5, 90)).toBe('good');
    expect(deltaTone('eq', 80, -15, 90)).toBe('bad');
    expect(deltaTone('eq', 85, -10, 90)).toBe('neutral');
  });

  it('stays neutral when nothing changed', () => {
    expect(deltaTone('gte', 1000, 0, 1100)).toBe('neutral');
  });
});
