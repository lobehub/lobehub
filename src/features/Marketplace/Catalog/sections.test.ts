import { describe, expect, it } from 'vitest';

import { buildCatalogListUrl, isCatalogListView, orderCategoriesByCount } from './sections';

const categories = [
  { key: 'all', label: 'All' },
  { key: 'coding', label: 'Coding' },
  { key: 'docs', label: 'Docs' },
  { key: 'web', label: 'Web' },
  { key: 'empty', label: 'Empty' },
];

describe('orderCategoriesByCount', () => {
  it('keeps categories with items, the largest first, without the pseudo categories', () => {
    const result = orderCategoriesByCount(
      categories,
      [
        { category: 'all', count: 99 },
        { category: 'coding', count: 10 },
        { category: 'docs', count: 30 },
        { category: 'web', count: 10 },
        { category: 'empty', count: 0 },
      ],
      ['all'],
    );

    expect(result.map((item) => item.key)).toEqual(['docs', 'coding', 'web']);
    expect(result[0]).toEqual({ count: 30, key: 'docs', label: 'Docs' });
  });

  it('shows no category group before the counts load', () => {
    expect(orderCategoriesByCount(categories, [], ['all'])).toEqual([]);
  });
});

describe('buildCatalogListUrl', () => {
  it('links a group heading to its full list', () => {
    expect(buildCatalogListUrl('/marketplace/skill', { category: 'docs' })).toBe(
      '/marketplace/skill?category=docs',
    );
    expect(buildCatalogListUrl('/marketplace/connector', { sort: 'createdAt' })).toBe(
      '/marketplace/connector?sort=createdAt',
    );
  });
});

describe('isCatalogListView', () => {
  it('shows groups on the bare Discover page', () => {
    expect(isCatalogListView({})).toBe(false);
  });

  it.each([{ category: 'docs' }, { q: 'pdf' }, { sort: 'createdAt' }, { page: 2 }])(
    'shows one full list once narrowed by %o',
    (query) => {
      expect(isCatalogListView(query)).toBe(true);
    },
  );
});
