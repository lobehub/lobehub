import { describe, expect, it } from 'vitest';

import { parseWidgetOutput, WIDGET_OUTPUT_LIMITS } from '../outputContract';

const json = (value: unknown) => JSON.stringify(value);

describe('parseWidgetOutput', () => {
  it.each([
    ['stat', { type: 'stat', unit: 'PRs', value: 12 }],
    ['list', { items: [{ status: 'open', title: 'Fix login', url: 'https://x' }], type: 'list' }],
    [
      'series',
      { series: [{ name: 'stars', points: [{ t: '2026-09-01', v: 10 }] }], type: 'series' },
    ],
    [
      'table',
      {
        columns: [{ key: 'name' }, { key: 'count', type: 'number' }],
        rows: [{ count: 1, name: 'a' }],
        type: 'table',
      },
    ],
  ] as const)('accepts a valid %s output', (type, output) => {
    const result = parseWidgetOutput(json(output), type);

    expect(result).toEqual({ ok: true, output, partial: false, partialMessage: undefined });
  });

  it('treats meta.complete=false as a partial success', () => {
    const result = parseWidgetOutput(
      json({ meta: { complete: false, message: 'GitLab timed out' }, type: 'stat', value: 3 }),
      'stat',
    );

    expect(result).toMatchObject({ ok: true, partial: true, partialMessage: 'GitLab timed out' });
  });

  it('tolerates log lines before the final JSON line', () => {
    const result = parseWidgetOutput(`fetching...\npage 2\n${json({ type: 'stat', value: 1 })}\n`);

    expect(result).toMatchObject({ ok: true, output: { type: 'stat', value: 1 } });
  });

  it('rejects a series output that repeats a series name', () => {
    const stdout = JSON.stringify({
      series: [
        { name: 'stars', points: [{ t: '2026-10-01', v: 1 }] },
        { name: 'stars', points: [{ t: '2026-10-02', v: 2 }] },
      ],
      type: 'series',
    });
    expect(parseWidgetOutput(stdout, 'series')).toMatchObject({
      code: 'INVALID_OUTPUT',
      ok: false,
    });
  });

  it('rejects empty stdout', () => {
    expect(parseWidgetOutput('  \n')).toMatchObject({ code: 'EMPTY_OUTPUT', ok: false });
  });

  it('rejects non-JSON stdout', () => {
    expect(parseWidgetOutput('hello world')).toMatchObject({ code: 'INVALID_JSON', ok: false });
  });

  it('rejects documents that break the contract', () => {
    const result = parseWidgetOutput(json({ type: 'stat' }));

    expect(result).toMatchObject({ code: 'INVALID_OUTPUT', ok: false });
    expect(!result.ok && result.message).toContain('value');
  });

  it('rejects unknown output types', () => {
    expect(parseWidgetOutput(json({ type: 'pie', value: 1 }))).toMatchObject({
      code: 'INVALID_OUTPUT',
      ok: false,
    });
  });

  it('rejects an output whose type differs from the declared one', () => {
    expect(parseWidgetOutput(json({ items: [], type: 'list' }), 'stat')).toMatchObject({
      code: 'OUTPUT_TYPE_MISMATCH',
      ok: false,
    });
  });

  it('rejects output over the byte limit', () => {
    const big = json({
      description: 'x'.repeat(WIDGET_OUTPUT_LIMITS.bytes),
      type: 'stat',
      value: 1,
    });

    expect(parseWidgetOutput(big)).toMatchObject({ code: 'OUTPUT_TOO_LARGE', ok: false });
  });

  it('rejects too many list items', () => {
    const items = Array.from({ length: WIDGET_OUTPUT_LIMITS.listItems + 1 }, (_, i) => ({
      title: `item ${i}`,
    }));

    expect(parseWidgetOutput(json({ items, type: 'list' }))).toMatchObject({
      code: 'OUTPUT_TOO_LARGE',
      ok: false,
    });
  });

  it('rejects duplicate table column keys', () => {
    expect(
      parseWidgetOutput(json({ columns: [{ key: 'a' }, { key: 'a' }], rows: [], type: 'table' })),
    ).toMatchObject({ code: 'INVALID_OUTPUT', ok: false });
  });

  it('rejects non-finite series values', () => {
    expect(
      parseWidgetOutput('{"type":"series","series":[{"name":"a","points":[{"t":"x","v":"NaN"}]}]}'),
    ).toMatchObject({ code: 'INVALID_OUTPUT', ok: false });
  });
});
