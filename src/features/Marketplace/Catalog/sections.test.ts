import { describe, expect, it } from 'vitest';

import {
  buildCatalogListUrl,
  catalogSearchParams,
  isCatalogListView,
  orderCategoriesByCount,
} from './sections';

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
  it('shows groups on the bare Discover page and when searching across the catalog', () => {
    const queryWithSearch = { category: undefined, q: 'pdf' };
    expect(isCatalogListView({})).toBe(false);
    expect(isCatalogListView(queryWithSearch)).toBe(false);
  });

  it.each([{ category: 'docs' }, { sort: 'createdAt' }, { page: 2 }])(
    'shows one full list once narrowed by %o',
    (query) => {
      expect(isCatalogListView(query)).toBe(true);
    },
  );
});

describe('catalogSearchParams', () => {
  it('keeps category and ordering when searching from a later page', () => {
    const params = new URLSearchParams('category=docs&sort=name&order=asc&page=3&q=old');

    expect(catalogSearchParams(params, '  pdf parser  ').toString()).toBe(
      'category=docs&sort=name&order=asc&q=pdf+parser',
    );
    expect(params.get('page')).toBe('3');
  });

  it('clears only the text and page inside a local group', () => {
    const params = new URLSearchParams('group=integrations&q=github&page=2');

    expect(catalogSearchParams(params, ' ').toString()).toBe('group=integrations');
  });

  it('includes the active search when linking to a category', () => {
    expect(
      buildCatalogListUrl('/marketplace/connector', { category: 'productivity', q: 'files' }),
    ).toBe('/marketplace/connector?category=productivity&q=files');
  });
});
