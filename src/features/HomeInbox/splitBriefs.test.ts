import { describe, expect, it } from 'vitest';

import { type BriefItem } from '@/features/DailyBrief/types';

import { splitBriefs } from './splitBriefs';

const brief = (id: string, type: BriefItem['type']): BriefItem =>
  ({ id, summary: '', title: id, type }) as BriefItem;

const scheduledResult = (id: string): BriefItem =>
  ({ ...brief(id, 'result'), taskStatus: 'scheduled' }) as BriefItem;

describe('splitBriefs', () => {
  it('routes insight briefs to news and everything else to needsYou', () => {
    const { needsYou, news } = splitBriefs([
      brief('a', 'decision'),
      brief('b', 'insight'),
      brief('c', 'result'),
      brief('d', 'error'),
    ]);

    expect(needsYou.map((b) => b.id)).toEqual(['a', 'c', 'd']);
    expect(news.map((b) => b.id)).toEqual(['b']);
  });

  it('routes scheduled task results to news instead of needsYou', () => {
    const recurringReport = scheduledResult('run-now-scheduled-task-report');
    const oneOffDelivery = brief('one-off-delivery', 'result');

    const { needsYou, news } = splitBriefs([recurringReport, oneOffDelivery]);

    expect(needsYou.map((item) => item.id)).toEqual(['one-off-delivery']);
    expect(news.map((item) => item.id)).toEqual(['run-now-scheduled-task-report']);
  });

  it('sinks errors to the bottom of needsYou', () => {
    const { needsYou } = splitBriefs([
      brief('err', 'error'),
      brief('res', 'result'),
      brief('dec', 'decision'),
    ]);

    expect(needsYou.map((b) => b.id)).toEqual(['dec', 'res', 'err']);
  });

  it('preserves server order within the same rank', () => {
    const { needsYou } = splitBriefs([
      brief('d1', 'decision'),
      brief('d2', 'decision'),
      brief('d3', 'decision'),
    ]);

    expect(needsYou.map((b) => b.id)).toEqual(['d1', 'd2', 'd3']);
  });

  it('returns empty groups for an empty feed', () => {
    expect(splitBriefs([])).toEqual({ needsYou: [], news: [] });
  });
});
