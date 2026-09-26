import { describe, expect, it } from 'vitest';

import {
  describeLiteXMLEditStep,
  indexLiteXMLDocument,
  planLiteXMLEditSteps,
  touchesList,
} from '../liteXMLEditPlan';

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

  it('splits a same-anchor insert run where list content starts, applying pieces last-first', () => {
    const empty = indexLiteXMLDocument('<root><p id="x"></p></root>');
    const steps = planLiteXMLEditSteps([
      { action: 'insert', afterId: 'x', litexml: '<h3>Title</h3>' },
      { action: 'insert', afterId: 'x', litexml: '<p>Intro</p>' },
      { action: 'insert', afterId: 'x', litexml: '<ul><li>a</li></ul>' },
      { action: 'remove', id: 'x' },
    ]);

    expect(steps.map((step) => step.indexes)).toEqual([[2], [0, 1], [3]]);
    expect(steps[1].operation).toMatchObject({
      litexml: '<root><h3>Title</h3><p>Intro</p></root>',
    });
    expect(steps.map((step) => touchesList(step.operation, empty))).toEqual([true, false, false]);
  });

  it('groups same-anchor inserts across operations that leave the anchor alone', () => {
    const steps = planLiteXMLEditSteps([
      { action: 'insert', afterId: 'x', litexml: '<p>A</p>' },
      { action: 'modify', litexml: '<p id="y">Y</p>' },
      { action: 'insert', afterId: 'x', litexml: '<p>B</p>' },
    ]);

    expect(steps.map((step) => step.indexes)).toEqual([[0, 2], [1]]);
    expect(steps[0].operation).toMatchObject({ litexml: '<root><p>A</p><p>B</p></root>' });
    expect(describeLiteXMLEditStep(steps[0], 3)).toBe('Operations 1, 3 of 3 (insert)');
  });

  it('stops grouping at an operation that touches the anchor', () => {
    const steps = planLiteXMLEditSteps([
      { action: 'insert', afterId: 'x', litexml: '<p>A</p>' },
      { action: 'remove', id: 'x' },
      { action: 'insert', afterId: 'x', litexml: '<p>B</p>' },
    ]);

    expect(steps.map((step) => step.indexes)).toEqual([[0], [1], [2]]);
  });
});
