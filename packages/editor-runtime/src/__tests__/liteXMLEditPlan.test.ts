import { describe, expect, it } from 'vitest';

import {
  canApplyAsReviewDiff,
  describeLiteXMLEditStep,
  findLiteXMLEditStepProblem,
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

  it('rejects a modify whose fragments target a node and one enclosed by it', () => {
    const operation = {
      action: 'modify' as const,
      litexml: [
        '<ul id="l"><li id="x"><span>x2</span></li></ul>',
        '<li id="x"><span>x3</span></li>',
      ],
    };

    expect(findLiteXMLEditStepProblem(operation, nested)).toContain('node "l" encloses node "x"');
    expect(
      findLiteXMLEditStepProblem(
        { action: 'modify', litexml: ['<span id="s">x2</span>', '<ul id="l"></ul>'] },
        nested,
      ),
    ).toContain('node "l" encloses node "s"');
    expect(
      findLiteXMLEditStepProblem(
        { action: 'modify', litexml: ['<p id="y">1</p>', '<p id="y">2</p>'] },
        flat,
      ),
    ).toContain('more than one fragment');
    expect(
      findLiteXMLEditStepProblem(
        { action: 'modify', litexml: ['<p id="x">1</p>', '<p id="y">2</p>'] },
        flat,
      ),
    ).toBeUndefined();
  });

  it('keeps a mixed modify with overlapping targets whole so it fails before any part applies', () => {
    const quoted = indexLiteXMLDocument(
      '<root><blockquote id="q"><ul id="l"><li id="x">x</li></ul></blockquote></root>',
    );
    const operation = {
      action: 'modify' as const,
      litexml: ['<blockquote id="q"><p>q</p></blockquote>', '<li id="x">x2</li>'],
    };
    const steps = planLiteXMLEditSteps([operation], quoted);

    expect(steps.map((step) => step.operation)).toEqual([operation]);
    expect(findLiteXMLEditStepProblem(steps[0].operation, quoted)).toContain(
      'node "q" encloses node "x"',
    );
  });

  describe('canApplyAsReviewDiff', () => {
    const doc = indexLiteXMLDocument(
      '<root><h2 id="h"><span id="hs">Title</span></h2><p id="p"><span id="ps">a</span></p><table id="t"><tr id="r"><td id="c"><span id="cs">1</span></td></tr></table><ul id="u"><li id="l"><span id="ls">x</span></li></ul></root>',
    );

    it('keeps the review diff for whole top-level blocks', () => {
      expect(
        canApplyAsReviewDiff({ action: 'modify', litexml: '<p id="p"><span>b</span></p>' }, doc),
      ).toBe(true);
      expect(
        canApplyAsReviewDiff(
          { action: 'insert', afterId: 'p', litexml: '<p><span>n</span></p>' },
          doc,
        ),
      ).toBe(true);
      expect(canApplyAsReviewDiff({ action: 'remove', id: 'h' }, doc)).toBe(true);
    });

    // A review diff around a nested node re-keys its block (inline) or nests a
    // diff the editor later rejects (tables), so those apply directly.
    it('applies nested, table and list edits directly', () => {
      expect(
        canApplyAsReviewDiff({ action: 'modify', litexml: '<span id="hs">T</span>' }, doc),
      ).toBe(false);
      expect(canApplyAsReviewDiff({ action: 'remove', id: 'ps' }, doc)).toBe(false);
      expect(
        canApplyAsReviewDiff(
          { action: 'insert', afterId: 'r', litexml: '<tr><td><span>2</span></td></tr>' },
          doc,
        ),
      ).toBe(false);
      expect(
        canApplyAsReviewDiff(
          {
            action: 'insert',
            afterId: 'p',
            litexml: '<table><tr><td><span>2</span></td></tr></table>',
          },
          doc,
        ),
      ).toBe(false);
      expect(
        canApplyAsReviewDiff({ action: 'modify', litexml: '<span id="ls">y</span>' }, doc),
      ).toBe(false);
    });
  });

  describe('findLiteXMLEditStepProblem payload checks', () => {
    const doc = indexLiteXMLDocument(
      '<root><p id="p"><span id="ps">a</span></p><ul id="u"><li id="l"><span id="ls">x</span></li></ul></root>',
    );

    it('names an operation without a valid action instead of throwing', () => {
      expect(
        findLiteXMLEditStepProblem({ beforeId: 'p', litexml: '<p><span>n</span></p>' } as any, doc),
      ).toBe('`action` must be "insert", "modify" or "remove"');
    });

    it('rejects litexml whose tags do not balance', () => {
      expect(
        findLiteXMLEditStepProblem(
          { action: 'insert', afterId: 'p', litexml: '<p><span>A.</span> text</span></p>' },
          doc,
        ),
      ).toBe('the litexml is not well-formed (<p> is closed by </span>)');
    });

    it('rejects a modify that swaps a list item or span for another kind of node', () => {
      expect(
        findLiteXMLEditStepProblem({ action: 'modify', litexml: '<span id="l">y</span>' }, doc),
      ).toBe(
        'node "l" is a <li>, but the modify payload replaces it with a <span>; send a <li id="l"> fragment',
      );
      expect(
        findLiteXMLEditStepProblem(
          { action: 'modify', litexml: '<h2 id="p"><span>t</span></h2>' },
          doc,
        ),
      ).toBeUndefined();
    });
  });
});
