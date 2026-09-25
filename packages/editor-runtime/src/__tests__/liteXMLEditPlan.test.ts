import { describe, expect, it } from 'vitest';

import { indexLiteXMLDocument, touchesList } from '../liteXMLEditPlan';

describe('liteXMLEditPlan', () => {
  it('indexes ids and marks nodes nested in lists', () => {
    const index = indexLiteXMLDocument(
      '<root><p id="p1"><span id="s1">x</span></p><ul id="u1"><li id="l1"><span id="s2">a</span></li></ul><br/></root>',
    );

    expect([...index.ids]).toEqual(['p1', 's1', 'u1', 'l1', 's2']);
    expect([...index.listIds]).toEqual(['u1', 'l1', 's2']);
    expect(touchesList({ action: 'remove', id: 's2' }, index)).toBe(true);
    expect(touchesList({ action: 'remove', id: 's1' }, index)).toBe(false);
  });

  it('scans unterminated tags in linear time', () => {
    const start = performance.now();
    indexLiteXMLDocument(`<p id="a">${'<a '.repeat(50_000)}`);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
