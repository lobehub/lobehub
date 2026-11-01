import { describe, expect, it } from 'vitest';

import { type BriefItem } from '@/features/DailyBrief/types';

import { arrangeDayNews, splitBriefs } from './splitBriefs';

const brief = (id: string, type: BriefItem['type'], priority: string | null = 'info'): BriefItem =>
  ({ id, priority, readAt: null, resolvedAt: null, summary: '', title: id, type }) as BriefItem;

describe('splitBriefs', () => {
  it('routes insight and result briefs to news and only decisions to needsYou', () => {
    const { needsYou, news } = splitBriefs([
      brief('a', 'decision'),
      brief('b', 'insight'),
      brief('c', 'result'),
      brief('d', 'error'),
    ]);

    expect(needsYou.map((b) => b.id)).toEqual(['a']);
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

  // Failures belong in the notification center, not in the decision queue.
  it('keeps legacy error briefs out of needsYou and news', () => {
    const { needsYou, news } = splitBriefs([brief('err', 'error'), brief('dec', 'decision')]);

    expect(needsYou.map((b) => b.id)).toEqual(['dec']);
    expect(news).toEqual([]);
  });

  it('removes an optimistically resolved decision from needsYou immediately', () => {
    const resolved = {
      ...brief('resolved', 'decision'),
      resolvedAction: 'ignore',
      resolvedAt: '2026-08-15T00:00:00.000Z',
    } as BriefItem;

    expect(splitBriefs([resolved]).needsYou).toEqual([]);
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

  it('promotes unresolved urgent insight and result briefs into needsYou', () => {
    const { needsYou, news } = splitBriefs([
      brief('urgent-insight', 'insight', 'urgent'),
      brief('urgent-result', 'result', 'urgent'),
      brief('normal-result', 'result', 'normal'),
      brief('info-insight', 'insight', 'info'),
    ]);

    expect(needsYou.map((b) => b.id)).toEqual(['urgent-insight', 'urgent-result']);
    expect(news.map((b) => b.id)).toEqual(['normal-result', 'info-insight']);
  });

  it('drops an urgent news brief from needsYou once resolved', () => {
    const resolved = {
      ...brief('urgent-insight', 'insight', 'urgent'),
      resolvedAt: '2026-10-15T00:00:00.000Z',
    } as BriefItem;

    expect(splitBriefs([resolved])).toEqual({ needsYou: [], news: [resolved] });
  });
});

describe('arrangeDayNews', () => {
  it('orders the day by priority, keeping server order within a level', () => {
    const day = [
      brief('info-new', 'insight', 'info'),
      brief('normal-new', 'result', 'normal'),
      brief('unknown', 'result', null),
      brief('urgent-done', 'insight', 'urgent'),
      brief('normal-old', 'result', 'normal'),
    ];
    day[3] = { ...day[3], resolvedAt: '2026-10-15T00:00:00.000Z' } as BriefItem;

    expect(arrangeDayNews(day, []).map((b) => b.id)).toEqual([
      'urgent-done',
      'normal-new',
      'normal-old',
      'info-new',
      'unknown',
    ]);
  });

  it('hides urgent briefs already waiting in needsYou so they never show twice', () => {
    const urgent = brief('urgent', 'insight', 'urgent');
    const normal = brief('normal', 'result', 'normal');

    expect(arrangeDayNews([urgent, normal], [urgent]).map((b) => b.id)).toEqual(['normal']);
  });

  it('keeps an unresolved urgent brief the unresolved feed does not carry', () => {
    const urgent = brief('urgent', 'insight', 'urgent');

    expect(arrangeDayNews([urgent], []).map((b) => b.id)).toEqual(['urgent']);
  });

  it('returns a just-handled urgent brief to the day as resolved', () => {
    const stale = brief('urgent', 'insight', 'urgent');
    const fresh = {
      ...stale,
      resolvedAction: 'acknowledge',
      resolvedAt: '2026-10-15T00:00:00.000Z',
    } as BriefItem;

    const [shown] = arrangeDayNews([stale], [fresh]);
    expect(shown.resolvedAt).toBe(fresh.resolvedAt);
    expect(shown.resolvedAction).toBe('acknowledge');
  });
});
