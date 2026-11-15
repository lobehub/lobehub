import type { GoalReleaseGateDossier, GoalReleaseGateUnit } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  formatTokenEstimate,
  formatTokens,
  orderUnits,
  planDigest,
  splitUnitTitle,
  summarizeGate,
  unitRemark,
} from './gateSummary';

const unit = (patch: Partial<GoalReleaseGateUnit>) =>
  ({
    artifacts: [],
    nodeId: patch.title ?? 'node',
    runs: 1,
    status: 'resolved',
    title: 'Unit',
    tokens: 1_000_000,
    ...patch,
  }) as GoalReleaseGateUnit;

describe('splitUnitTitle', () => {
  it('reads a short leading code apart from the name', () => {
    expect(splitUnitTitle('A2 Balance card')).toEqual({ code: 'A2', name: 'Balance card' });
  });

  it('keeps a title whose first word is not a code whole', () => {
    expect(splitUnitTitle('Migrate the balance card')).toEqual({
      name: 'Migrate the balance card',
    });
    expect(splitUnitTitle('Balance')).toEqual({ name: 'Balance' });
  });
});

describe('formatTokens', () => {
  it('keeps one decimal on a compact count', () => {
    expect(formatTokens(5_000_000)).toBe('5.0M');
    expect(formatTokens(2_840_000)).toBe('2.8M');
    expect(formatTokens(50_400_000)).toBe('50.4M');
    expect(formatTokens(1_200_000_000)).toBe('1.2B');
    expect(formatTokens(12_300)).toBe('12.3K');
  });

  it('leaves a count under a thousand whole', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(950)).toBe('950');
  });
});

describe('formatTokenEstimate', () => {
  it('rounds an estimate to two significant digits', () => {
    expect(formatTokenEstimate(56_400_000)).toBe('56M');
    expect(formatTokenEstimate(5_640_000)).toBe('5.6M');
    expect(formatTokenEstimate(123_000_000)).toBe('120M');
  });
});

describe('unitRemark', () => {
  it('has nothing to say about a unit that settled in one run', () => {
    expect(unitRemark(unit({}), 1_000_000)).toBeUndefined();
  });

  it('flags a unit that did not settle, reworked or not', () => {
    expect(unitRemark(unit({ runs: 3, status: 'failed' as never }), 1_000_000)).toEqual({
      kind: 'unsettled',
    });
  });

  it('counts the rework rounds of a reworked unit', () => {
    expect(unitRemark(unit({ runs: 2, tokens: 1_200_000 }), 1_000_000)).toEqual({
      kind: 'reworked',
      rework: 1,
    });
  });

  it('adds the cost ratio once a reworked unit used 1.5× the average', () => {
    expect(unitRemark(unit({ runs: 3, tokens: 5_000_000 }), 3_133_333)).toEqual({
      kind: 'reworkedCostly',
      ratio: '1.6',
      rework: 2,
    });
  });

  it('does not compare against an empty average', () => {
    expect(unitRemark(unit({ runs: 2, tokens: 0 }), 0)).toEqual({ kind: 'reworked', rework: 1 });
  });
});

describe('orderUnits', () => {
  it('leads with unsettled units, then reworked ones, and keeps the rest in report order', () => {
    const units = [
      unit({ title: 'A1' }),
      unit({ runs: 2, title: 'A2' }),
      unit({ title: 'A3' }),
      unit({ status: 'failed' as never, title: 'A4' }),
      unit({ runs: 3, title: 'A5' }),
    ];
    expect(orderUnits(units).map((item) => item.title)).toEqual(['A4', 'A2', 'A5', 'A1', 'A3']);
  });

  it('does not reorder the dossier it was given', () => {
    const units = [unit({ title: 'A1' }), unit({ runs: 2, title: 'A2' })];
    orderUnits(units);
    expect(units.map((item) => item.title)).toEqual(['A1', 'A2']);
  });
});

describe('summarizeGate', () => {
  const dossier = {
    checks: [{ passed: true }, { passed: true }, { passed: false }],
    nextWave: [{ title: 'A4 Profile' }, { title: 'A5 Appearance' }, { title: 'A6 Hotkeys' }],
    remainingAfter: 12,
    units: [
      unit({ title: 'A1 Usage page', tokens: 2_800_000 }),
      unit({ runs: 2, title: 'A2 Balance card', tokens: 5_000_000 }),
      unit({ runs: 2, title: 'Request log', tokens: 1_600_000 }),
    ],
  } as unknown as GoalReleaseGateDossier;

  it('derives the counts the report quotes', () => {
    const summary = summarizeGate(dossier);
    expect(summary.average).toBeCloseTo(3_133_333.33, 1);
    expect(summary.remaining).toBe(15);
    expect(summary.estimate).toBeCloseTo(47_000_000, 0);
    expect(summary.checks).toEqual({ passed: 2, total: 3 });
  });

  it('names reworked units by code, or by title when they carry none', () => {
    expect(summarizeGate(dossier).reworked).toEqual(['A2', 'Request log']);
  });

  it('lists the reworked units first', () => {
    expect(summarizeGate(dossier).units.map((item) => item.title)).toEqual([
      'A2 Balance card',
      'Request log',
      'A1 Usage page',
    ]);
  });

  it('reports no average for a gate without units', () => {
    const summary = summarizeGate({ ...dossier, units: [] });
    expect(summary.average).toBe(0);
    expect(summary.estimate).toBe(0);
  });
});

describe('planDigest', () => {
  it('reads the leading heading as the title and the next paragraph as the summary', () => {
    expect(
      planDigest(
        '# Migrate one settings page to StyleX\n\nMove the page’s `createStaticStyles` blocks to **stylex.create**.\nKeep tokens through [cssVar](https://example.com).\n\n## Steps\n- one',
      ),
    ).toEqual({
      hasMore: true,
      summary:
        'Move the page’s createStaticStyles blocks to stylex.create. Keep tokens through cssVar.',
      title: 'Migrate one settings page to StyleX',
    });
  });

  it('skips the skill frontmatter', () => {
    expect(planDigest('---\nname: settings-stylex\n---\n\n# Title\n\nBody')).toEqual({
      hasMore: false,
      summary: 'Body',
      title: 'Title',
    });
  });

  it('summarizes a plan that opens on prose without inventing a title', () => {
    expect(
      planDigest('Persist the resource, show stale data first.\n\n## Pitfalls\n- Scope'),
    ).toEqual({
      hasMore: true,
      summary: 'Persist the resource, show stale data first.',
    });
  });

  it('reads a list that opens the plan as its summary', () => {
    expect(planDigest('- Persist the resource\n- Revalidate')).toEqual({
      hasMore: false,
      summary: 'Persist the resource Revalidate',
    });
  });

  it('is empty for an empty plan', () => {
    expect(planDigest('')).toEqual({ hasMore: false });
  });
});
