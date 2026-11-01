import { describe, expect, it } from 'vitest';

import { parseGreetingLine } from '../welcomeText';

describe('parseGreetingLine', () => {
  it('keeps a plain sentence untouched and finds no links', () => {
    expect(parseGreetingLine('你今天有 3 个任务在跑')).toEqual({
      links: [],
      plain: '你今天有 3 个任务在跑',
    });
  });

  it('keeps only the first finding, so two lines never read as one claim', () => {
    expect(parseGreetingLine('PR 已经处理完\ndesktop PR 还停在 queued').plain).toBe(
      'PR 已经处理完',
    );
  });

  it('skips leading blank lines and collapses inner whitespace', () => {
    expect(parseGreetingLine('\n\n  两个   任务 在跑  \n第二条').plain).toBe('两个 任务 在跑');
  });

  it('drops bold markers the generator sometimes emits', () => {
    expect(parseGreetingLine('你有 **2** 条待办').plain).toBe('你有 2 条待办');
  });

  it('unwraps a markdown link and positions it against the visible text', () => {
    const { links, plain } = parseGreetingLine('[推特周报](/task/T-1) 正在等你确认');

    expect(plain).toBe('推特周报 正在等你确认');
    expect(links).toEqual([{ end: 4, href: '/task/T-1', start: 0, text: '推特周报' }]);
    expect(plain.slice(links[0].start, links[0].end)).toBe('推特周报');
  });

  it('auto-links a bare issue reference', () => {
    const { links, plain } = parseGreetingLine('PR #17604 已经处理完');

    expect(links).toHaveLength(1);
    expect(links[0].href).toBe('https://github.com/lobehub/lobehub/issues/17604');
    expect(plain.slice(links[0].start, links[0].end)).toBe('#17604');
  });

  it('positions link spans correctly when text precedes the link', () => {
    const { links, plain } = parseGreetingLine('先看 [任务](/task/T-9) 再说');

    expect(plain).toBe('先看 任务 再说');
    expect(plain.slice(links[0].start, links[0].end)).toBe('任务');
  });

  it('keeps every link span in order across multiple links', () => {
    const { links, plain } = parseGreetingLine('[A](/a) 和 [B](/b) 都好了');

    expect(links.map((l) => plain.slice(l.start, l.end))).toEqual(['A', 'B']);
    expect(links.map((l) => l.href)).toEqual(['/a', '/b']);
  });

  it('lets an explicit link win over an overlapping auto-link', () => {
    const { links, plain } = parseGreetingLine('[#17604](/task/T-3) 已合并');

    expect(links).toHaveLength(1);
    expect(links[0].href).toBe('/task/T-3');
    expect(plain.slice(links[0].start, links[0].end)).toBe('#17604');
  });

  it('returns an empty result for a blank welcome', () => {
    expect(parseGreetingLine('   \n  ')).toEqual({ links: [], plain: '' });
  });
});
