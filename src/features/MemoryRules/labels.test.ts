import { describe, expect, it } from 'vitest';

import { appendException, findMove, revisionAuthorKey } from './labels';

describe('appendException', () => {
  it('keeps the exceptions already written and adds the new one below', () => {
    expect(appendException('图表内部的间距不算', '打印样式不算')).toBe(
      '图表内部的间距不算\n打印样式不算',
    );
  });

  it('starts the list when there is nothing yet', () => {
    expect(appendException(undefined, '  图表内部的间距不算 ')).toBe('图表内部的间距不算');
  });

  it('replaces the "no boundary given" placeholder instead of keeping it above', () => {
    expect(appendException('边界未由评审者说明', '图表内部的间距不算')).toBe('图表内部的间距不算');
  });

  it('does not add the same exception twice', () => {
    expect(appendException('图表内部的间距不算\n打印样式不算', '打印样式不算')).toBe(
      '图表内部的间距不算\n打印样式不算',
    );
  });
});

describe('findMove', () => {
  it('describes a drag upward as "now before" its new neighbour', () => {
    expect(findMove(['a', 'b', 'c', 'd'], ['c', 'a', 'b', 'd'])).toEqual({
      beforeId: 'a',
      id: 'c',
    });
  });

  it('describes a drag to the end with no neighbour after it', () => {
    expect(findMove(['a', 'b', 'c'], ['b', 'c', 'a'])).toEqual({ beforeId: null, id: 'a' });
  });

  it('reports nothing when the order did not change', () => {
    expect(findMove(['a', 'b'], ['a', 'b'])).toBeNull();
  });
});

describe('revisionAuthorKey', () => {
  it("credits the reader only with their own edits, not a teammate's", () => {
    expect(revisionAuthorKey({ byViewer: true, changedBy: 'user' })).toBe('rules.revisions.byYou');
    expect(revisionAuthorKey({ byViewer: false, changedBy: 'user' })).toBe(
      'rules.revisions.byTeammate',
    );
  });

  it('attributes a generalization to the system', () => {
    expect(revisionAuthorKey({ byViewer: false, changedBy: 'system' })).toBe(
      'rules.revisions.bySystem',
    );
  });
});
