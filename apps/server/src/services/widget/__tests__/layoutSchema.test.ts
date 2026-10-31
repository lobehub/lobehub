import { systemPrompt } from '@lobechat/builtin-tool-dashboard';
import { describe, expect, it } from 'vitest';

import { widgetLayoutSchema } from '../layoutSchema';
import { widgetViewSchema } from '../versionSchema';

const text = (value: unknown) => ({ type: 'text', value });

describe('widgetLayoutSchema', () => {
  it('accepts a nested layout with bindings, templates, conditions and a repeat', () => {
    const result = widgetLayoutSchema.safeParse({
      children: [
        text({ bind: 'data.temp', digits: 0, format: 'number' }),
        text({ template: 'H {data.hi}° · L {data.lo}°' }),
        {
          color: { bind: 'data.level', map: { 'high': 'error', '*': 'success' } },
          name: 'thermometer',
          type: 'icon',
          visible: { bind: 'data.temp', gt: 30 },
        },
        {
          items: 'data.hourly',
          limit: 6,
          template: text({ bind: 'item.t', format: 'time' }),
          type: 'repeat',
        },
        { kind: 'area', key: 'temp', type: 'sparkline', values: 'data.hourly' },
        { max: 100, type: 'ring', value: { bind: 'data.pct' }, children: [text('ok')] },
      ],
      type: 'stack',
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ['an unknown node type', { type: 'script', value: 'alert(1)' }],
    ['an unknown property', { type: 'text', value: 'x', style: { color: 'red' } }],
    ['an unknown literal icon', { name: 'rocket-ship', type: 'icon' }],
    ['an unknown literal color', { color: '#ff0000', type: 'progress', value: 1 }],
    ['a non-https image', { src: 'http://example.com/a.png', type: 'image' }],
    ['a path with brackets', text({ bind: 'data.hourly[0]' })],
  ])('rejects %s', (_, layout) => {
    expect(widgetLayoutSchema.safeParse(layout).success).toBe(false);
  });

  it('rejects a layout nested deeper than the limit', () => {
    let layout: Record<string, unknown> = text('leaf');
    for (let depth = 0; depth < 13; depth += 1) layout = { children: [layout], type: 'stack' };

    const result = widgetLayoutSchema.safeParse(layout);

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('nested deeper');
  });

  it('rejects a repeat nested in another repeat', () => {
    const repeat = (template: unknown) => ({ items: 'data.items', template, type: 'repeat' });

    const result = widgetLayoutSchema.safeParse(repeat(repeat(repeat(repeat(text('x'))))));

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('cannot be nested');
  });

  it('rejects a layout whose repeats expand past the drawn-node limit', () => {
    const row = { children: Array.from({ length: 60 }, () => text('x')), type: 'stack' };
    const repeat = (limit?: number) => ({
      items: 'data.items',
      limit,
      template: row,
      type: 'repeat',
    });

    expect(widgetLayoutSchema.safeParse(repeat(10)).success).toBe(true);
    const result = widgetLayoutSchema.safeParse(repeat());
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('once repeats');
  });

  it('counts each dot and bar a node draws, so a small tree cannot fan out into many elements', () => {
    const dots = (total: unknown) => ({ total, type: 'dots', value: 1 });
    const repeat = (template: unknown, limit = 48) => ({
      items: 'data.items',
      limit,
      template,
      type: 'repeat',
    });

    // a year of dots on its own fits
    expect(widgetLayoutSchema.safeParse(dots(365)).success).toBe(true);
    // 19 bound dot grids repeated 48 times would draw ~365k dots
    const fanOut = repeat({
      children: Array.from({ length: 19 }, () => dots({ bind: 'item' })),
      type: 'stack',
    });
    const result = widgetLayoutSchema.safeParse(fanOut);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('dots and bars');
    // bar sparklines are weighed by their bars too
    expect(
      widgetLayoutSchema.safeParse(repeat({ kind: 'bar', type: 'sparkline', values: 'item.v' }, 12))
        .success,
    ).toBe(false);
  });

  it('rejects a layout with more nodes than the limit', () => {
    const result = widgetLayoutSchema.safeParse({
      children: Array.from({ length: 200 }, () => text('x')),
      type: 'stack',
    });

    expect(result.success).toBe(false);
  });
});

describe('widgetViewSchema surface', () => {
  it('accepts a surface name or a binding, and rejects an unknown name', () => {
    expect(widgetViewSchema.safeParse({ surface: 'rain' }).success).toBe(true);
    expect(
      widgetViewSchema.safeParse({ surface: { bind: 'data.cond', map: { rain: 'rain' } } }).success,
    ).toBe(true);
    expect(widgetViewSchema.safeParse({ surface: 'neon' }).success).toBe(false);
  });
});

describe('dashboard tool prompt', () => {
  it('teaches a weather view that passes validation', () => {
    const example = systemPrompt.split('and the view is\n')[1]?.split('\n</card_layout>')[0];

    expect(example).toBeTruthy();
    expect(widgetViewSchema.safeParse(JSON.parse(example!)).success).toBe(true);
  });
});
