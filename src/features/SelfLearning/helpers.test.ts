import { describe, expect, it } from 'vitest';

import {
  earlyPassRate,
  habitTier,
  layerLabel,
  passRateSeries,
  previewSections,
  profileWord,
  recentPassRate,
  zeroViolationStreak,
} from './helpers';

const p = { pass: true };
const v = { pass: false };

describe('habitTier', () => {
  it('treats fewer than two hits as fresh even when one failed', () => {
    expect(habitTier([])).toBe('fresh');
    expect(habitTier([v])).toBe('fresh');
  });

  it('flags two or more recent violations as a recurring problem', () => {
    expect(habitTier([p, v, p, v, v, p])).toBe('recurring');
  });

  it('flags a single recent violation as shaky', () => {
    expect(habitTier([p, p, v, p, p, p])).toBe('shaky');
  });

  it('calls a clean recent record stable', () => {
    expect(habitTier([p, p, p])).toBe('stable');
  });
});

describe('profileWord', () => {
  it('prefers weak over unstable when both are present', () => {
    expect(profileWord({ fresh: 0, recurring: 1, shaky: 2, stable: 5 }, 8)).toBe('weak');
  });
  it('is fresh for an empty layer', () => {
    expect(profileWord({ fresh: 0, recurring: 0, shaky: 0, stable: 0 }, 0)).toBe('fresh');
  });
  it('is stable only when everything is stable', () => {
    expect(profileWord({ fresh: 1, recurring: 0, shaky: 0, stable: 3 }, 4)).toBe('mostlyStable');
    expect(profileWord({ fresh: 0, recurring: 0, shaky: 0, stable: 4 }, 4)).toBe('stable');
  });
});

describe('layerLabel', () => {
  it('uses a sequential user-facing label instead of the internal layer key', () => {
    expect(layerLabel(0)).toBe('L1');
    expect(layerLabel(11)).toBe('L12');
  });
});

describe('reliability series', () => {
  const rel = [
    { pass: 2, run: 1, violation: 2 },
    { pass: 0, run: 2, violation: 0 },
    { pass: 3, run: 3, violation: 1 },
    { pass: 4, run: 4, violation: 0 },
    { pass: 5, run: 5, violation: 0 },
  ];

  it('drops runs that judged nothing', () => {
    expect(passRateSeries(rel).map((s) => s.run)).toEqual([1, 3, 4, 5]);
  });

  it('counts the trailing zero-violation streak only across runs that judged something', () => {
    expect(zeroViolationStreak(rel)).toBe(2);
    expect(zeroViolationStreak([{ pass: 0, run: 1, violation: 0 }])).toBe(0);
  });

  it('averages recent and early windows', () => {
    const s = passRateSeries(rel);
    expect(recentPassRate(s, 2)).toBe(1);
    expect(earlyPassRate(s, 2)).toBeCloseTo((0.5 + 0.75) / 2);
    expect(recentPassRate([])).toBeNull();
  });
});

describe('previewSections', () => {
  it('drops the rule section, which only restates the title the card already shows', () => {
    expect(
      previewSections([
        { body: '分离运行执行面与观测访问面', key: 'rule' },
        { body: '两个面的故障域不同', key: 'why' },
      ]).map((section) => section.key),
    ).toEqual(['why']);
  });

  it('never renders a labelled blank row', () => {
    expect(previewSections([{ body: '   ', key: 'why' }])).toEqual([]);
    expect(previewSections()).toEqual([]);
  });

  it('carries the label key so every surface names a section the same way', () => {
    expect(previewSections([{ body: '补齐文档后通过', key: 'how' }])).toEqual([
      { body: '补齐文档后通过', key: 'how', label: 'rules.section.how' },
    ]);
  });
});
