import { describe, expect, it } from 'vitest';

import {
  chunkIds,
  countTasksCreatedByOthers,
  isEditableTarget,
  mergeOutcomes,
  pruneSelection,
  selectRange,
  toggleSelection,
} from './taskSelectionModel';

const order = ['a', 'b', 'c', 'd', 'e'];

describe('taskSelectionModel', () => {
  it('toggles an id in and out', () => {
    expect(toggleSelection([], 'a')).toEqual(['a']);
    expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('selects the visible range between the anchor and the clicked row, either direction', () => {
    expect(selectRange(order, [], 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(selectRange(order, ['a'], 'd', 'b')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('falls back to selecting the clicked row without an anchor', () => {
    expect(selectRange(order, ['a'], undefined, 'c')).toEqual(['a', 'c']);
    expect(selectRange(order, ['a'], 'gone', 'c')).toEqual(['a', 'c']);
    expect(selectRange(order, ['a'], 'a', 'not-in-list')).toEqual(['a']);
  });

  it('prunes ids that left the list and keeps identity when nothing changed', () => {
    const selected = ['a', 'b'];
    expect(pruneSelection(selected, new Set(order))).toBe(selected);
    expect(pruneSelection(['a', 'x'], new Set(order))).toEqual(['a']);
  });

  it('chunks a large selection into request-sized batches', () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `t${i}`);
    expect(chunkIds(ids).map((chunk) => chunk.length)).toEqual([500, 500, 1]);
    expect(chunkIds([])).toEqual([]);
  });

  it('merges per-chunk outcomes', () => {
    expect(
      mergeOutcomes([
        { failed: [], skipped: [{ id: 'b', reason: 'running' }], updated: ['a'] },
        { failed: [{ error: 'x', id: 'd' }], skipped: [], updated: ['c'] },
      ]),
    ).toEqual({
      failed: [{ error: 'x', id: 'd' }],
      followUpFailed: false,
      skipped: [{ id: 'b', reason: 'running' }],
      updated: ['a', 'c'],
    });
  });

  it('treats text fields as editable targets', () => {
    const input = document.createElement('input');
    const div = document.createElement('div');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.append(input, div, editable);
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(div)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it('counts the selected tasks another member created', () => {
    const tasks = [
      { createdByUserId: 'me' },
      { createdByUserId: 'teammate' },
      { createdByUserId: 'other-teammate' },
      { createdByUserId: null },
    ];
    expect(countTasksCreatedByOthers(tasks, 'me')).toBe(2);
    expect(countTasksCreatedByOthers(tasks, undefined)).toBe(0);
    expect(countTasksCreatedByOthers([], 'me')).toBe(0);
  });
});
