import { describe, expect, it } from 'vitest';

import {
  hasBotRetroLogEntry,
  parseBotLessons,
  prependBotRetroLogEntry,
  renderBotLessons,
  renderBotRetroLogEntry,
} from '../documents';

describe('bot retro documents', () => {
  it('round-trips lessons through the lessons document', () => {
    const lessons = [
      'Confirm the thread before replying',
      'Change approach after one failed retry',
    ];

    expect(parseBotLessons(renderBotLessons(lessons))).toEqual(lessons);
  });

  it('reads lessons the owner edited by hand, whatever list marker they used', () => {
    const content = '# Bot lessons\n\nIntro line\n\n* first\n1. second\n- third\nnot a list item';

    expect(parseBotLessons(content)).toEqual(['first', 'second', 'third']);
    expect(parseBotLessons(undefined)).toEqual([]);
  });

  it('marks each platform issue as vented or not and leaves empty sections out', () => {
    const entry = renderBotRetroLogEntry({
      date: '2026-11-01',
      platformIssues: [
        { detail: 'returned 500 three times', title: 'web search down', vented: true },
        { detail: 'no tool to edit a sent message', title: 'missing edit tool', vented: false },
      ],
      selfMistakes: [],
      summary: 'A busy day.',
    });

    expect(entry).toContain('## 2026-11-01');
    expect(entry).toContain('- [vented] **web search down** — returned 500 three times');
    expect(entry).toContain('- [not vented] **missing edit tool**');
    expect(entry).not.toContain('### My mistakes');
  });

  it('prepends the newest entry, keeps the owner header and caps the entry count', () => {
    let content: string | undefined;
    for (const day of ['01', '02', '03']) {
      content = prependBotRetroLogEntry(
        content,
        renderBotRetroLogEntry({
          date: `2026-11-${day}`,
          platformIssues: [],
          selfMistakes: [{ lesson: 'ask first', what: `guessed on day ${day}` }],
          summary: `Day ${day}.`,
        }),
        2,
      );
    }

    expect(content!.startsWith('# Bot retro log')).toBe(true);
    expect(content!.indexOf('## 2026-11-03')).toBeLessThan(content!.indexOf('## 2026-11-02'));
    expect(content).not.toContain('## 2026-11-01');
    expect(content).toContain('- guessed on day 03 → next time: ask first');
  });

  it('detects an already written day so a second tick skips it', () => {
    const content = prependBotRetroLogEntry(
      undefined,
      renderBotRetroLogEntry({
        date: '2026-11-01',
        platformIssues: [],
        selfMistakes: [],
        summary: 'Quiet.',
      }),
    );

    expect(hasBotRetroLogEntry(content, '2026-11-01')).toBe(true);
    expect(hasBotRetroLogEntry(content, '2026-11-02')).toBe(false);
    expect(hasBotRetroLogEntry(undefined, '2026-11-01')).toBe(false);
  });
});
