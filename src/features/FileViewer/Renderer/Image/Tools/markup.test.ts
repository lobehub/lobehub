import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { buildMarkupMessage, describeAnchor, describeArea, type ImageMarkup } from './markup';

// Echo the key and its values so the assertions read the full sentence shape.
const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key) as unknown as TFunction<'file'>;

const brush = { color: '#f00', points: [{ x: 0, y: 0 }], size: 0.01, type: 'brush' as const };

describe('describeArea', () => {
  it.each([
    [{ x: 0.1, y: 0.1 }, 'topLeft'],
    [{ x: 0.5, y: 0.1 }, 'top'],
    [{ x: 0.9, y: 0.1 }, 'topRight'],
    [{ x: 0.1, y: 0.5 }, 'left'],
    [{ x: 0.5, y: 0.5 }, 'center'],
    [{ x: 0.9, y: 0.5 }, 'right'],
    [{ x: 0.1, y: 0.9 }, 'bottomLeft'],
    [{ x: 0.5, y: 0.9 }, 'bottom'],
    [{ x: 0.9, y: 0.9 }, 'bottomRight'],
  ])('%o is %s', (point, area) => {
    expect(describeArea(point)).toBe(area);
  });
});

describe('describeAnchor', () => {
  it('gives a point its area and rounded percentages', () => {
    expect(describeAnchor({ point: { x: 0.123, y: 0.876 }, type: 'point' }, t)).toBe(
      'imageViewer.markup.location.point {"area":"imageViewer.markup.area.bottomLeft","x":12,"y":88}',
    );
  });

  it('gives a region its span, located by its center', () => {
    expect(
      describeAnchor({ rect: { height: 0.3, width: 0.3, x: 0.6, y: 0.05 }, type: 'region' }, t),
    ).toBe(
      'imageViewer.markup.location.region {"area":"imageViewer.markup.area.topRight","x1":60,"x2":90,"y1":5,"y2":35}',
    );
  });
});

describe('buildMarkupMessage', () => {
  const comments: ImageMarkup['comments'] = [
    { anchor: { point: { x: 0.5, y: 0.5 }, type: 'point' }, id: 'a', text: '  Too dark  ' },
    {
      anchor: { rect: { height: 0.1, width: 0.1, x: 0, y: 0 }, type: 'region' },
      id: 'b',
      text: 'Remove',
    },
  ];
  const plain = ((key: string) => key) as unknown as TFunction<'file'>;

  it('numbers comments in the order they were added', () => {
    const lines = buildMarkupMessage({ comments, shapes: [] }, { name: 'a.png', t }).split('\n');

    expect(lines[0]).toBe('imageViewer.markup.message.header {"name":"a.png"}');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^imageViewer\.markup\.message\.item \{"index":1,/);
    expect(lines[1]).toContain('"text":"Too dark"');
    expect(lines[1]).toContain('imageViewer.markup.location.point');
    expect(lines[2]).toMatch(/^imageViewer\.markup\.message\.item \{"index":2,/);
    expect(lines[2]).toContain('"text":"Remove"');
    expect(lines[2]).toContain('imageViewer.markup.location.region');
  });

  it('mentions the drawing when there is one', () => {
    const text = buildMarkupMessage({ comments, shapes: [brush] }, { t: plain });
    expect(text.split('\n')[0]).toBe('imageViewer.markup.message.headerWithDrawing');
  });

  it('is a single line for a drawing without comments', () => {
    expect(buildMarkupMessage({ comments: [], shapes: [brush] }, { name: 'a.png', t })).toBe(
      'imageViewer.markup.message.drawingOnly {"name":"a.png"}',
    );
  });
});
