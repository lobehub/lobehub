import { describe, expect, it } from 'vitest';

import type { AcceptanceListItem } from '@/services/verify';

import {
  ACCEPTANCE_BATCH_CHUNK,
  acceptanceBatchTargets,
  acceptanceSelectAllState,
  chunkAcceptanceBatch,
  nextAcceptanceSelectAll,
  toggleAcceptanceSelection,
  visibleAcceptanceSelection,
} from './batchSelection';

const item = (id: string, status: string) =>
  ({ id, status, subject: { title: id }, subjectId: id }) as unknown as AcceptanceListItem;

describe('toggleAcceptanceSelection', () => {
  it('adds an unselected row and removes a selected one', () => {
    expect(toggleAcceptanceSelection(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleAcceptanceSelection(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('visibleAcceptanceSelection', () => {
  it('drops picks the active filter no longer shows', () => {
    // A sweep must act on exactly the ticked boxes on screen — never on a row
    // that left the list when the filter changed.
    expect(visibleAcceptanceSelection(['a', 'b'], [item('a', 'delivered')])).toEqual(['a']);
  });
});

describe('acceptanceSelectAllState', () => {
  it('reads none / partial / all from the visible counts', () => {
    expect(acceptanceSelectAllState(3, 0)).toBe('none');
    expect(acceptanceSelectAllState(3, 2)).toBe('partial');
    expect(acceptanceSelectAllState(3, 3)).toBe('all');
    expect(acceptanceSelectAllState(0, 0)).toBe('none');
  });
});

describe('nextAcceptanceSelectAll', () => {
  const visible = [item('a', 'delivered'), item('b', 'accepted')];

  it('selects every visible row from a partial selection', () => {
    expect(nextAcceptanceSelectAll(['a'], visible)).toEqual(['a', 'b']);
  });

  it('clears only the visible rows when everything visible is selected', () => {
    // 'hidden' was picked under another filter; unticking the visible boxes
    // must not silently discard it.
    expect(nextAcceptanceSelectAll(['a', 'b', 'hidden'], visible)).toEqual(['hidden']);
  });
});

describe('acceptanceBatchTargets', () => {
  const items = [
    item('delivered', 'delivered'),
    item('accepted', 'accepted'),
    item('verifying', 'verifying'),
    item('closed', 'closed'),
  ];
  const selected = items.map((entry) => entry.id);

  it('accepts only rows that can still be decided', () => {
    expect(acceptanceBatchTargets(items, selected, 'accept')).toEqual(['delivered']);
  });

  it('closes everything except what is already closed', () => {
    expect(acceptanceBatchTargets(items, selected, 'close')).toEqual([
      'delivered',
      'accepted',
      'verifying',
    ]);
  });

  it('ignores rows outside the selection', () => {
    expect(acceptanceBatchTargets(items, ['accepted'], 'close')).toEqual(['accepted']);
  });
});

describe('chunkAcceptanceBatch', () => {
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `id-${index}`);

  it('keeps a selection the server accepts in one request', () => {
    expect(chunkAcceptanceBatch(ids(3))).toEqual([ids(3)]);
    expect(chunkAcceptanceBatch(ids(ACCEPTANCE_BATCH_CHUNK))).toHaveLength(1);
  });

  it('splits a selection past the endpoint cap instead of letting it be refused', () => {
    // Select-all after enough scrolling can exceed the cap; one oversized
    // request fails before anything changes at all.
    const chunks = chunkAcceptanceBatch(ids(ACCEPTANCE_BATCH_CHUNK + 1));

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(ACCEPTANCE_BATCH_CHUNK);
    expect(chunks[1]).toEqual(['id-200']);
    expect(chunks.flat()).toEqual(ids(ACCEPTANCE_BATCH_CHUNK + 1));
  });

  it('has nothing to send for an empty selection', () => {
    expect(chunkAcceptanceBatch([])).toEqual([]);
  });
});
