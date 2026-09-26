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
    expect(index.ancestorIds.get('s2')).toEqual(['l1', 'u1']);
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
    const steps = planLiteXMLEditSteps(
      [
        { action: 'insert', afterId: 'x', litexml: '<h3>Title</h3>' },
        { action: 'insert', afterId: 'x', litexml: '<p>Intro</p>' },
        { action: 'insert', afterId: 'x', litexml: '<ul><li>a</li></ul>' },
        { action: 'remove', id: 'x' },
      ],
      empty,
    );

    expect(steps.map((step) => step.indexes)).toEqual([[2], [0, 1], [3]]);
    expect(steps[1].operation).toMatchObject({
      litexml: '<root><h3>Title</h3><p>Intro</p></root>',
    });
    expect(steps.map((step) => touchesList(step.operation, empty))).toEqual([true, false, false]);
  });

  const flat = indexLiteXMLDocument('<root><p id="x">x</p><p id="y">y</p></root>');
  const nested = indexLiteXMLDocument(
    '<root><ul id="l"><li id="x"><span id="s">x</span></li></ul><p id="y">y</p></root>',
  );

  it('groups same-anchor inserts across operations that leave the anchor alone', () => {
    const steps = planLiteXMLEditSteps(
      [
        { action: 'insert', afterId: 'x', litexml: '<p>A</p>' },
        { action: 'modify', litexml: '<p id="y">Y</p>' },
        { action: 'insert', afterId: 'x', litexml: '<p>B</p>' },
      ],
      flat,
    );

    expect(steps.map((step) => step.indexes)).toEqual([[0, 2], [1]]);
    expect(steps[0].operation).toMatchObject({ litexml: '<root><p>A</p><p>B</p></root>' });
    expect(describeLiteXMLEditStep(steps[0], 3)).toBe('Operations 1, 3 of 3 (insert)');
  });

  it('stops grouping at an operation that touches the anchor', () => {
    const steps = planLiteXMLEditSteps(
      [
        { action: 'insert', afterId: 'x', litexml: '<p>A</p>' },
        { action: 'remove', id: 'x' },
        { action: 'insert', afterId: 'x', litexml: '<p>B</p>' },
      ],
      flat,
    );

    expect(steps.map((step) => step.indexes)).toEqual([[0], [1], [2]]);
  });

  it('stops grouping at an operation that replaces a node enclosing the anchor', () => {
    const steps = planLiteXMLEditSteps(
      [
        { action: 'insert', afterId: 'x', litexml: '<li>A</li>' },
        { action: 'modify', litexml: '<ul id="l"><li id="x"><span id="s">x2</span></li></ul>' },
        { action: 'insert', afterId: 'x', litexml: '<li>B</li>' },
      ],
      nested,
    );

    expect(steps.map((step) => step.indexes)).toEqual([[0], [1], [2]]);
  });

  it('still groups past an edit nested inside the anchor', () => {
    const steps = planLiteXMLEditSteps(
      [
        { action: 'insert', afterId: 'x', litexml: '<li>A</li>' },
        { action: 'modify', litexml: '<span id="s">x2</span>' },
        { action: 'insert', afterId: 'x', litexml: '<li>B</li>' },
      ],
      nested,
    );

    expect(steps.map((step) => step.indexes)).toEqual([[0, 2], [1]]);
  });

  it('keeps an empty insert out of a merged run so its no-op is reported', () => {
    const steps = planLiteXMLEditSteps(
      [
        { action: 'insert', afterId: 'x', litexml: '<p>A</p>' },
        { action: 'insert', afterId: 'x', litexml: '  ' },
        { action: 'insert', afterId: 'x', litexml: '<p>B</p>' },
      ],
      flat,
    );

    expect(steps.map((step) => step.indexes)).toEqual([[2], [1], [0]]);
  });

  it('splits a modify mixing list and non-list fragments so only the list part skips review', () => {
    const steps = planLiteXMLEditSteps(
      [
        {
          action: 'modify',
          litexml: ['<p id="y">Y2</p>', '<span id="s">x2</span>'],
        },
      ],
      nested,
    );

    expect(steps.map((step) => step.indexes)).toEqual([[0], [0]]);
    expect(steps.map((step) => step.operation)).toEqual([
      { action: 'modify', litexml: ['<p id="y">Y2</p>'] },
      { action: 'modify', litexml: ['<span id="s">x2</span>'] },
    ]);
    expect(steps.map((step) => touchesList(step.operation, nested))).toEqual([false, true]);
  });
});
