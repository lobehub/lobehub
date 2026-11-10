import { describe, expect, it } from 'vitest';

import {
  buildConversationRows,
  findNeighbors,
  idsToMarkReadOnOpen,
  initialExpandedIds,
  initialFocusId,
  nextSelectionAfterRemoval,
} from './conversation';

const mail = (id: string, isUnread = false) => ({ id, isUnread });

describe('initialExpandedIds', () => {
  it('opens the newest mail and keeps older read mail collapsed', () => {
    expect([...initialExpandedIds([mail('a'), mail('b'), mail('c')])]).toEqual(['c']);
  });

  it('never folds away an unread mail', () => {
    expect([...initialExpandedIds([mail('a', true), mail('b'), mail('c')])].sort()).toEqual([
      'a',
      'c',
    ]);
  });
});

describe('reading position', () => {
  it('marks only what opening shows as read', () => {
    expect(idsToMarkReadOnOpen([mail('a'), mail('b', true)])).toEqual(['b']);
  });

  it('starts at the first unread, else the newest', () => {
    expect(initialFocusId([mail('a'), mail('b', true), mail('c', true)])).toBe('b');
    expect(initialFocusId([mail('a'), mail('b')])).toBe('b');
  });
});

describe('buildConversationRows', () => {
  const mails = Array.from({ length: 9 }, (_, index) => mail(`m${index}`));

  it('folds a long collapsed run into one line, keeping its ends', () => {
    const rows = buildConversationRows(mails, new Set(['m8']), false);

    expect(rows).toEqual([
      { id: 'm0', kind: 'mail' },
      { count: 6, firstHiddenIndex: 1, kind: 'fold' },
      { id: 'm7', kind: 'mail' },
      { id: 'm8', kind: 'mail' },
    ]);
  });

  it('lists a short conversation in full', () => {
    const rows = buildConversationRows(mails.slice(0, 3), new Set(['m2']), false);

    expect(rows.map((item) => item.kind)).toEqual(['mail', 'mail', 'mail']);
  });

  it('shows everything once unfolded', () => {
    expect(buildConversationRows(mails, new Set(['m8']), true)).toHaveLength(9);
  });
});

describe('list navigation', () => {
  const rows = [{ id: 'a' }, { id: 'c' }, { id: 'd' }];

  it('finds the row by any mail of the open conversation', () => {
    expect(findNeighbors(rows, new Set(['b', 'c']))).toEqual({
      nextId: 'd',
      previousId: 'a',
      rowId: 'c',
    });
  });

  it('has nothing either side at the ends of the list', () => {
    expect(findNeighbors(rows, new Set(['a']))).toEqual({
      nextId: 'c',
      previousId: undefined,
      rowId: 'a',
    });
  });

  it('has no neighbours for a conversation outside the loaded list', () => {
    expect(findNeighbors(rows, new Set(['zzz']))).toEqual({});
  });

  it('selects the older conversation after a delete, else the newer', () => {
    expect(nextSelectionAfterRemoval({ nextId: 'n', previousId: 'p' })).toBe('n');
    expect(nextSelectionAfterRemoval({ previousId: 'p' })).toBe('p');
    expect(nextSelectionAfterRemoval({})).toBeUndefined();
  });
});
