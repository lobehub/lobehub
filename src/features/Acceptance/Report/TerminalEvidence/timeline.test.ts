import type { AsciicastEvent } from '@lobechat/utils/verify/asciicast';
import { createTerminalSanitizer } from '@lobechat/utils/verify/terminalEvidence';
import { describe, expect, it } from 'vitest';

import {
  buildTimeline,
  castPlainText,
  clampTerminalSize,
  collectOps,
  eventCountAt,
  formatPlaybackClock,
} from './timeline';

const ev = (t: number, code: AsciicastEvent['code'], data: string): AsciicastEvent => ({
  code,
  data,
  t,
});

describe('buildTimeline', () => {
  it('compresses idle gaps longer than the cap and keeps shorter ones', () => {
    const timeline = buildTimeline({
      cols: 80,
      events: [ev(0.5, 'o', 'a'), ev(1, 'o', 'b'), ev(31, 'o', 'c'), ev(32.5, 'o', 'd')],
      rows: 24,
    });
    expect(timeline.events.map((event) => event.at)).toEqual([0.5, 1, 3, 4.5]);
    expect(timeline.duration).toBe(4.5);
  });

  it('extracts markers with their playback time, labelling unnamed ones', () => {
    const timeline = buildTimeline({
      cols: 80,
      events: [ev(0, 'o', 'x'), ev(10, 'm', ' build done '), ev(11, 'm', '')],
      rows: 24,
    });
    expect(timeline.markers).toEqual([
      { at: 2, label: 'build done' },
      { at: 3, label: '#2' },
    ]);
  });

  it('clamps an oversized starting terminal', () => {
    const timeline = buildTimeline({ cols: 1000, events: [], rows: 500 });
    expect([timeline.cols, timeline.rows]).toEqual([500, 200]);
    expect(timeline.duration).toBe(0);
  });
});

describe('eventCountAt', () => {
  const events = [{ at: 0 }, { at: 1 }, { at: 1 }, { at: 2.5 }];

  it('counts every event at or before the playhead', () => {
    expect(eventCountAt(events, -1)).toBe(0);
    expect(eventCountAt(events, 0)).toBe(1);
    expect(eventCountAt(events, 1)).toBe(3);
    expect(eventCountAt(events, 2.4)).toBe(3);
    expect(eventCountAt(events, 99)).toBe(4);
    expect(eventCountAt([], 5)).toBe(0);
  });
});

describe('collectOps', () => {
  const identity = (chunk: string) => chunk;

  it('merges consecutive output and orders resizes between writes', () => {
    const events = [
      ev(0, 'o', 'a'),
      ev(0.1, 'o', 'b'),
      ev(0.2, 'r', '100x30'),
      ev(0.3, 'i', 'typed'),
      ev(0.4, 'm', 'marker'),
      ev(0.5, 'o', 'c'),
      ev(0.6, 'x', '0'),
    ];
    expect(collectOps(events, 0, events.length, identity)).toEqual([
      { data: 'ab', type: 'write' },
      { cols: 100, rows: 30, type: 'resize' },
      { data: 'c', type: 'write' },
    ]);
    expect(collectOps(events, 5, 7, identity)).toEqual([{ data: 'c', type: 'write' }]);
  });

  it('strips OSC strings split across events with one sanitizer per pass', () => {
    const events = [
      ev(0, 'o', 'before \u001B]8;;https://evil'),
      ev(0.1, 'o', '.example\u0007link\u001B]8;;\u0007 after'),
      ev(0.2, 'o', ' \u001B]52;c;aGVsbG8=\u0007done'),
    ];
    const ops = collectOps(events, 0, events.length, createTerminalSanitizer());
    expect(ops).toEqual([{ data: 'before link after done', type: 'write' }]);
  });

  it('clamps hostile resizes and ignores malformed ones', () => {
    const events = [ev(0, 'r', '5000x5000'), ev(0, 'r', 'big')];
    expect(collectOps(events, 0, 2, identity)).toEqual([{ cols: 500, rows: 200, type: 'resize' }]);
  });
});

describe('clampTerminalSize', () => {
  it('keeps sizes within 1..max', () => {
    expect(clampTerminalSize(0, -3)).toEqual({ cols: 1, rows: 1 });
    expect(clampTerminalSize(120.7, 40.2)).toEqual({ cols: 120, rows: 40 });
  });
});

describe('castPlainText', () => {
  it('joins output events and strips escape sequences', () => {
    expect(
      castPlainText([
        ev(0, 'o', '\u001B[32mok\u001B[0m\r\n'),
        ev(0.1, 'i', 'ignored'),
        ev(0.2, 'o', '50%\r100%\r\n'),
      ]),
    ).toBe('ok\n100%\n');
  });
});

describe('formatPlaybackClock', () => {
  it('formats minutes and hours', () => {
    expect(formatPlaybackClock(0)).toBe('0:00');
    expect(formatPlaybackClock(65.9)).toBe('1:05');
    expect(formatPlaybackClock(3725)).toBe('1:02:05');
  });

  it('shows tenths for short recordings so they never read 0:00 / 0:00', () => {
    expect(formatPlaybackClock(0.8005, true)).toBe('0:00.8');
    expect(formatPlaybackClock(9.96, true)).toBe('0:09.9');
    expect(formatPlaybackClock(0, true)).toBe('0:00.0');
  });
});
