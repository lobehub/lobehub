import { describe, expect, it } from 'vitest';

import { catalogDetailQuery } from './catalogDetailQuery';

describe('installed item navigation', () => {
  it.each(['builtin-skill:task', 'mcp-connector:calendar'])(
    'returns from %s to the same filtered page',
    (selection) => {
      const filters = new URLSearchParams({
        category: 'tools',
        page: '2',
        q: 'docs',
        sort: 'name',
      });
      const detail = catalogDetailQuery(filters, selection);
      expect(detail.get('open')).toBe(selection);
      expect(catalogDetailQuery(detail).toString()).toBe(filters.toString());
      expect(filters.has('open')).toBe(false);
    },
  );

  it('closes a legacy skill deep link without reopening it', () => {
    expect(catalogDetailQuery(new URLSearchParams('skill=docs&q=docs')).toString()).toBe('q=docs');
  });
});
