import { describe, expect, it } from 'vitest';

import { ASCIICAST_LIMITS, AsciicastError, encodeAsciicastV3, parseAsciicast } from './asciicast';

const v3 = (...lines: unknown[]) => lines.map((line) => JSON.stringify(line)).join('\n');

describe('parseAsciicast', () => {
  it('reads v3 relative intervals as absolute times, with resize and exit events', () => {
    const cast = parseAsciicast(
      `${v3(
        {
          command: 'ls',
          term: { cols: 80, rows: 24, type: 'xterm-256color' },
          timestamp: 100,
          version: 3,
        },
        [0.5, 'o', 'a'],
        [0.25, 'r', '100x30'],
        [1, 'x', '2'],
      )}\n# trailing comment\n`,
    );
    expect(cast).toMatchObject({
      cols: 80,
      command: 'ls',
      duration: 1.75,
      exitStatus: 2,
      rows: 24,
      termType: 'xterm-256color',
      timestamp: 100,
      version: 3,
    });
    expect(cast.events.map((e) => e.t)).toEqual([0.5, 0.75, 1.75]);
  });

  it('reads v2 absolute times and its env TERM', () => {
    const cast = parseAsciicast(
      v3(
        { env: { TERM: 'xterm' }, height: 5, version: 2, width: 40 },
        [0.1, 'o', 'a'],
        [0.4, 'o', 'b'],
      ),
    );
    expect(cast).toMatchObject({
      cols: 40,
      exitStatus: null,
      rows: 5,
      termType: 'xterm',
      version: 2,
    });
    expect(cast.events.map((e) => e.t)).toEqual([0.1, 0.4]);
  });

  it.each([
    ['empty input', ''],
    ['an unknown version', v3({ height: 5, version: 1, width: 5 })],
    ['a missing size', v3({ version: 3 })],
    ['an oversized terminal', v3({ term: { cols: 5000, rows: 5 }, version: 3 })],
    ['a non-JSON event', `${v3({ term: { cols: 5, rows: 5 }, version: 3 })}\nnot json`],
    ['an unknown event code', v3({ term: { cols: 5, rows: 5 }, version: 3 }, [0, 'z', 'x'])],
    ['a negative time', v3({ term: { cols: 5, rows: 5 }, version: 3 }, [-1, 'o', 'x'])],
    [
      'v2 time going backwards',
      v3({ height: 5, version: 2, width: 5 }, [1, 'o', 'a'], [0.5, 'o', 'b']),
    ],
    ['a malformed resize', v3({ term: { cols: 5, rows: 5 }, version: 3 }, [0, 'r', 'wide'])],
    ['an oversized resize', v3({ term: { cols: 5, rows: 5 }, version: 3 }, [0, 'r', '5000x5'])],
  ])('refuses %s', (_, text) => {
    expect(() => parseAsciicast(text)).toThrow(AsciicastError);
  });

  it('enforces event, size and duration limits', () => {
    const header = { term: { cols: 5, rows: 5 }, version: 3 };
    const limits = { ...ASCIICAST_LIMITS, maxDurationSeconds: 10, maxEventBytes: 4, maxEvents: 2 };
    expect(() => parseAsciicast(v3(header, [0, 'o', 'too long']), limits)).toThrow(
      /exceeds 4 bytes/,
    );
    expect(() =>
      parseAsciicast(v3(header, [0, 'o', 'a'], [0, 'o', 'b'], [0, 'o', 'c']), limits),
    ).toThrow(/more than 2 events/);
    expect(() => parseAsciicast(v3(header, [11, 'o', 'a']), limits)).toThrow(/past 10 seconds/);
    expect(() => parseAsciicast(v3(header), { ...limits, maxBytes: 10 })).toThrow(
      /exceeds 10 bytes/,
    );
  });

  it('names the offending line', () => {
    try {
      parseAsciicast(`${v3({ term: { cols: 5, rows: 5 }, version: 3 })}\n\n[0, 'o']`);
      expect.unreachable();
    } catch (error) {
      expect((error as AsciicastError).line).toBe(3);
    }
  });
});

describe('encodeAsciicastV3', () => {
  it('round-trips through the parser with relative intervals', () => {
    const text = encodeAsciicastV3(
      { cols: 10, command: 'echo', rows: 3, termType: 'xterm', timestamp: 7.9 },
      [
        { code: 'o', data: 'hi', t: 0.1 },
        { code: 'r', data: '20x5', t: 0.3 },
        { code: 'x', data: '0', t: 0.35 },
      ],
    );
    expect(text.split('\n')[1]).toBe('[0.1,"o","hi"]');
    const cast = parseAsciicast(text);
    expect(cast).toMatchObject({ command: 'echo', exitStatus: 0, timestamp: 7, version: 3 });
    expect(cast.events.map((e) => Math.round(e.t * 1e6) / 1e6)).toEqual([0.1, 0.3, 0.35]);
  });
});
