import { describe, expect, it } from 'vitest';

import type { AcceptanceListItem } from '@/services/verify';

import { filterAcceptanceList, normalizeAcceptanceListFilter } from './acceptanceListFilter';

const item = (
  id: string,
  status: AcceptanceListItem['status'],
  title: string,
): AcceptanceListItem =>
  ({
    id,
    status,
    subject: { title },
    subjectId: id,
  }) as AcceptanceListItem;

const acceptances = [
  item('active', 'delivered', 'Needs review'),
  item('completed', 'accepted', 'Signed off'),
  item('failed', 'rejected', 'Needs repair'),
];

describe('filterAcceptanceList', () => {
  it('hides completed acceptances by default', () => {
    expect(filterAcceptanceList(acceptances, 'active', '').map(({ id }) => id)).toEqual([
      'active',
      'failed',
    ]);
  });

  it('can show only completed acceptances', () => {
    expect(filterAcceptanceList(acceptances, 'completed', '').map(({ id }) => id)).toEqual([
      'completed',
    ]);
  });

  it('combines status filtering with title search', () => {
    expect(filterAcceptanceList(acceptances, 'all', 'signed').map(({ id }) => id)).toEqual([
      'completed',
    ]);
    expect(filterAcceptanceList(acceptances, 'active', 'signed')).toEqual([]);
  });
});

describe('normalizeAcceptanceListFilter', () => {
  it('falls back to the active filter for malformed persisted values', () => {
    expect(normalizeAcceptanceListFilter('unknown')).toBe('active');
    expect(normalizeAcceptanceListFilter(null)).toBe('active');
  });
});
