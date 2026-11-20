import { describe, expect, it } from 'vitest';

import { searchMatches } from './derive';
import { formatAgo } from './format';
import { type MemoryEntity } from './types';

const entity = (id: string, title: string, description = ''): MemoryEntity => ({
  capturedAt: '2026-10-01T00:00:00.000Z',
  description,
  id,
  kind: 'project',
  names: [],
  status: 'active',
  summary: '',
  tags: [],
  title,
  updatedAt: '2026-10-01T00:00:00.000Z',
});

describe('searchMatches', () => {
  it('keeps server hits whose match is in a field the list does not hold', () => {
    const loaded = [entity('a', 'Migration'), entity('b', 'Wedding')];
    // The server matched this one on its status / parent details, not title or description.
    const remote = [entity('old', 'Quarterly review')];

    expect(searchMatches(loaded, 'blocked', remote).map((e) => e.id)).toEqual(['old']);
  });

  it('combines local matches with server hits without duplicates', () => {
    const loaded = [entity('a', 'Composio swap'), entity('b', 'Wedding')];
    const remote = [entity('a', 'Composio swap'), entity('c', 'OAuth retro')];

    expect(searchMatches(loaded, 'composio', remote).map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('shows everything loaded when there is no keyword', () => {
    const loaded = [entity('a', 'A'), entity('b', 'B')];
    expect(searchMatches(loaded, '  ', [entity('c', 'C')])).toBe(loaded);
  });
});

describe('formatAgo', () => {
  const now = new Date('2026-10-24T12:00:00');

  it('follows the user language', () => {
    expect(formatAgo('2026-10-21T09:00:00', 'en-US', now)).toBe('3 days ago');
    expect(formatAgo('2026-10-21T09:00:00', 'zh-CN', now)).toBe('3天前');
    expect(formatAgo('2026-10-24T08:00:00', 'en-US', now)).toBe('today');
  });
});
