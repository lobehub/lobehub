import { describe, expect, it } from 'vitest';

import {
  checkCondition,
  createLayoutScope,
  formatLayoutValue,
  getPath,
  LAYOUT_SERIES_MAX_POINTS,
  resolveColor,
  resolveNumbers,
  resolveRaw,
  resolveSurface,
  resolveText,
} from './resolve';

const scope = createLayoutScope({
  data: {
    city: 'Hangzhou',
    cond: 'rain',
    hi: 21,
    hourly: [
      { t: '2026-10-31T14:00:00', temp: 18 },
      { t: '2026-10-31T15:00:00', temp: 17.5 },
    ],
    temp: 18.44,
  },
  type: 'data',
});

describe('getPath', () => {
  it('reads nested keys and array indexes, and stops at missing parents', () => {
    expect(getPath(scope, 'data.hourly.1.temp')).toBe(17.5);
    expect(getPath(scope, 'data.missing.temp')).toBeUndefined();
  });
});

describe('createLayoutScope', () => {
  it('exposes a built-in output as data, so a stat binds the same way', () => {
    expect(getPath(createLayoutScope({ type: 'stat', value: 3 }), 'data.value')).toBe(3);
  });
});

describe('resolveText', () => {
  it('formats a bound number', () => {
    expect(resolveText({ bind: 'data.temp', digits: 0, format: 'number' }, scope)).toBe('18');
  });

  it('fills a template, formatting slots that name a format', () => {
    expect(resolveText({ template: '{data.city} {data.hourly.0.t|time}' }, scope)).toBe(
      'Hangzhou 14:00',
    );
  });

  it('takes fraction digits after the format in a template slot', () => {
    expect(resolveText({ template: '{data.temp|number:0}°' }, scope)).toBe('18°');
  });

  it('prints a mapped value as-is and uses the fallback for a missing path', () => {
    expect(resolveText({ bind: 'data.cond', map: { rain: 'Rain' } }, scope)).toBe('Rain');
    expect(resolveText({ bind: 'data.nope', fallback: '--' }, scope)).toBe('--');
  });

  it('never prints an object', () => {
    expect(resolveText({ bind: 'data.hourly' }, scope)).toBe('');
  });
});

describe('resolveRaw', () => {
  it('uses the "*" entry when the map has no match', () => {
    expect(resolveRaw({ bind: 'data.cond', map: { '*': 'cloud', 'sun': 'sun' } }, scope)).toBe(
      'cloud',
    );
  });
});

describe('formatLayoutValue', () => {
  it('formats a ratio as a percent', () => {
    expect(formatLayoutValue(0.42, 'percent')).toBe('42%');
  });
});

describe('checkCondition', () => {
  it.each([
    [{ bind: 'data.temp', gt: 18 }, true],
    [{ bind: 'data.temp', lt: 10 }, false],
    [{ bind: 'data.cond', in: ['rain', 'snow'] }, true],
    [{ bind: 'data.cond', ne: 'rain' }, false],
    [{ bind: 'data.alerts', exists: true }, false],
    [{ bind: 'data.alerts', exists: false }, true],
    [{ bind: 'data.city', gt: 1 }, false],
  ])('%j → %s', (condition, expected) => {
    expect(checkCondition(condition, scope)).toBe(expected);
  });
});

describe('resolveSurface / resolveColor', () => {
  it('maps data to a known surface and falls back to default', () => {
    expect(resolveSurface({ bind: 'data.cond', map: { rain: 'rain' } }, scope)).toBe('rain');
    expect(resolveSurface('neon', scope)).toBe('default');
  });

  it('falls back to the text color for unknown colors', () => {
    expect(resolveColor('#f00', scope)).toBe('currentColor');
    expect(resolveColor(undefined, scope)).toBe('currentColor');
  });
});

describe('resolveNumbers', () => {
  it('reads one key of each item and skips non-numbers', () => {
    expect(resolveNumbers('data.hourly', scope, 'temp')).toEqual([18, 17.5]);
    expect(resolveNumbers('data.city', scope)).toEqual([]);
  });

  it('samples a huge array down to the point cap, keeping both ends', () => {
    const big = createLayoutScope({
      data: { values: Array.from({ length: 130_000 }, (_, index) => index) },
      type: 'data',
    });

    const values = resolveNumbers('data.values', big);

    expect(values).toHaveLength(LAYOUT_SERIES_MAX_POINTS);
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(129_999);
  });
});
