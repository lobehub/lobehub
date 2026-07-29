import { describe, expect, it } from 'vitest';

import { type BriefItem } from '@/features/DailyBrief/types';

import { splitBriefs } from './splitBriefs';

const brief = (id: string, type: BriefItem['type']): BriefItem =>
  ({ id, summary: '', title: id, type }) as BriefItem;

describe('splitBriefs', () => {
  it('routes insight and result briefs to news, decision and error to needsYou', () => {
    const { needsYou, news } = splitBriefs([
      brief('a', 'decision'),
      brief('b', 'insight'),
      brief('c', 'result'),
      brief('d', 'error'),
    ]);

    expect(needsYou.map((b) => b.id)).toEqual(['a', 'd']);
    expect(news.map((b) => b.id)).toEqual(['b', 'c']);
  });

  it('routes results to news regardless of the parent task runtime status', () => {
    const scheduledReport = { ...brief('scheduled-report', 'result'), taskStatus: 'scheduled' };
    const pausedTaskReport = { ...brief('paused-task-report', 'result'), taskStatus: 'paused' };
    const detachedResult = brief('detached-result', 'result');

    const { needsYou, news } = splitBriefs([
      scheduledReport,
      pausedTaskReport,
      detachedResult,
    ] as BriefItem[]);

    expect(needsYou).toEqual([]);
    expect(news.map((item) => item.id)).toEqual([
      'scheduled-report',
      'paused-task-report',
      'detached-result',
    ]);
  });

  it('sinks errors to the bottom of needsYou', () => {
    const { needsYou } = splitBriefs([brief('err', 'error'), brief('dec', 'decision')]);

    expect(needsYou.map((b) => b.id)).toEqual(['dec', 'err']);
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
