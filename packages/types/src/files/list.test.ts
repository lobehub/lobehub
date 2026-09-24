import { describe, expect, it } from 'vitest';

import { parseResourceListSorter, QueryFileListSchema } from './list';

describe('QueryFileListSchema sorter', () => {
  it('accepts the name sort the resource explorer sends (#19802)', () => {
    const result = QueryFileListSchema.safeParse({ sorter: 'name', sortType: 'asc' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sorter).toBe('name');
  });

  it('accepts updatedAt, which the list query can already order by', () => {
    expect(QueryFileListSchema.safeParse({ sorter: 'updatedAt' }).success).toBe(true);
  });

  it('rejects a sorter the list query cannot order by', () => {
    const result = QueryFileListSchema.safeParse({ sorter: 'fileType' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'sorter')).toBe(true);
    }
  });
});

describe('parseResourceListSorter', () => {
  it('keeps a known sorter', () => {
    expect(parseResourceListSorter('name')).toBe('name');
    expect(parseResourceListSorter('updatedAt')).toBe('updatedAt');
  });

  it('falls back instead of forwarding a value the API would reject', () => {
    expect(parseResourceListSorter('fileType')).toBe('createdAt');
    expect(parseResourceListSorter(null)).toBe('createdAt');
    expect(parseResourceListSorter(undefined)).toBe('createdAt');
  });
});
