import { describe, expect, it } from 'vitest';

import type { ComponentSnapshot } from './capture';
import { compareComponents } from './compareSnapshots';

const snapshot = (style: Record<string, string> = {}): ComponentSnapshot => ({
  attributes: [{ attributes: [['role', 'status']], key: 'root.0', text: ' Text ' }],
  backend: 'hybrid',
  tree: {
    animations: [],
    durationMs: 0,
    nodes: [
      {
        box: [0, 0, 10, 10],
        key: 'root.0',
        scroll: [10, 10, 10, 10],
        style: 0,
        tag: 'SPAN',
        text: 'Text',
      },
    ],
    propertyReads: Object.keys(style).length,
    styles: [style],
  },
});

describe('extended component tree comparison', () => {
  it('detects SVG/render attributes even when computed styles are equal', () => {
    const before = snapshot();
    const after = snapshot();
    before.attributes[0].attributes = [['d', 'M0 0L10 10']];
    after.attributes[0].attributes = [['d', 'M0 0L20 20']];
    expect(compareComponents(before, after).differences).toContainEqual(
      expect.objectContaining({ key: 'root.0', property: 'DOM_ATTRIBUTES_OR_TEXT_CHANGED' }),
    );
  });
  it('does not trim away rendering-relevant whitespace', () => {
    const after = snapshot();
    after.attributes[0].text = 'Text';
    expect(compareComponents(snapshot(), after).differences).toHaveLength(1);
  });
  it('never blanket-ignores unknown custom properties', () => {
    const result = compareComponents(
      snapshot({ '--unknown': 'red' }),
      snapshot({ '--unknown': 'blue' }),
    );
    expect(result.raw).toHaveLength(1);
    expect(result.review).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(0);
  });
  it('retains a custom property and its resolved consumer change separately', () => {
    const result = compareComponents(
      snapshot({ '--x': 'red', 'color': 'red' }),
      snapshot({ '--x': 'blue', 'color': 'blue' }),
    );
    expect(result.review).toHaveLength(1);
    expect(result.differences).toContainEqual(expect.objectContaining({ property: 'color' }));
  });
  it('explains only contextually nonpainting border differences', () => {
    const style = {
      'border-top-color': 'red',
      'border-top-style': 'none',
      'border-top-width': '0px',
    };
    expect(
      compareComponents(snapshot(style), snapshot({ ...style, 'border-top-color': 'blue' }))
        .diagnostics,
    ).toHaveLength(1);
    expect(
      compareComponents(
        snapshot({ ...style, 'border-top-style': 'solid', 'border-top-width': '1px' }),
        snapshot({
          ...style,
          'border-top-color': 'blue',
          'border-top-style': 'solid',
          'border-top-width': '1px',
        }),
      ).differences,
    ).toHaveLength(1);
  });
});
