import { describe, expect, it } from 'vitest';

import type { MetricSeriesWithPoints } from '@/services/metric';

import { buildNorthStarCards, formatMetricValue, NORTH_STAR_STALE_AFTER_MS } from './northStar';

const NOW = Date.parse('2026-09-06T12:00:00Z');

const series = (
  key: string,
  values: number[],
  overrides: Partial<MetricSeriesWithPoints> = {},
): MetricSeriesWithPoints => ({
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

describe('formatMetricValue', () => {
  it('groups integers and passes fractions through', () => {
    expect(formatMetricValue(72_180)).toBe('72,180');
    expect(formatMetricValue(0.07)).toBe('0.07');
    expect(formatMetricValue(null)).toBe('—');
  });
});
