import { describe, expect, it } from 'vitest';

import { buildReviewPlanItems } from './reviewPlan';

const mark = (id: string, seq: number, content: string) => ({
  content,
  id,
  pageUrl: 'https://website.example/notebook',
  seq,
});

const marks = [
  mark('m1', 1, 'Title is too small'),
  mark('m2', 2, 'Button looks disabled'),
  mark('m3', 3, 'Cards are too tight'),
  mark('m4', 4, 'Footer link is broken'),
];

describe('buildReviewPlanItems', () => {
  it('turns every mark into a required check on the first run, keyed by mark id', () => {
    const items = buildReviewPlanItems(marks, new Map());

    expect(items.map((item) => item.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(items[2]).toMatchObject({
      index: 2,
      onFail: 'manual',
      required: true,
      title: '#3 Cards are too tight',
      verifierType: 'agent',
    });
    expect(items[2].description).toContain('Cards are too tight');
    expect(items[2].description).toContain('https://website.example/notebook');
  });

  it('carries only marks that are not settled into a re-run', () => {
    const previous = new Map([
      ['m1', { state: 'failed' as const, userDecision: 'accepted' as const }],
      ['m2', { state: 'passed' as const, userDecision: 'rejected' as const }],
      ['m3', { state: 'failed' as const, userDecision: null }],
      ['m4', { state: 'passed' as const, userDecision: null }],
    ]);

    expect(buildReviewPlanItems(marks, previous).map((item) => item.id)).toEqual(['m2', 'm3']);
  });

  it('re-runs a mark that never got a result', () => {
    const previous = new Map([
      ['m1', { state: 'passed' as const, userDecision: 'accepted' as const }],
      ['m2', { state: 'not_executed' as const, userDecision: null }],
    ]);

    expect(buildReviewPlanItems(marks.slice(0, 3), previous).map((item) => item.id)).toEqual([
      'm2',
      'm3',
    ]);
  });

  it('cuts long remarks in the title but keeps them whole in the description', () => {
    const long = 'x'.repeat(80);
    const [item] = buildReviewPlanItems([mark('m9', 9, long)], new Map());

    expect(item.title).toBe(`#9 ${'x'.repeat(40)}…`);
    expect(item.description).toContain(long);
  });

  it('re-plans every mark a person has not passed when nothing else was flagged', () => {
    const previous = new Map([
      ['m1', { state: 'passed' as const, userDecision: 'accepted' as const }],
      ['m2', { state: 'passed' as const, userDecision: null }],
      ['m3', { state: 'passed' as const, userDecision: null }],
    ]);

    expect(buildReviewPlanItems(marks.slice(0, 3), previous).map((item) => item.id)).toEqual([
      'm2',
      'm3',
    ]);
  });
});
