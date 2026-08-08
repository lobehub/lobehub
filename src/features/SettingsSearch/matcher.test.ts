import { describe, expect, it } from 'vitest';

import { createSettingsSearchFuse, MAX_SEARCH_RESULTS } from './matcher';

const entries = [
  { haystack: ['appearance', 'theme', '主题', 'zhuti', 'zt'], key: 'tab-appearance' },
  { haystack: ['theme mode', 'dark mode', 'light'], key: 'item-theme-mode' },
  { haystack: ['充值', 'chongzhi', 'cz', 'top up', 'recharge'], key: 'item-top-up' },
  // Polyphone drift: the pinyin dict renders 重置 as `zhongzhi`
  { haystack: ['重置', 'zhongzhi', 'zz', 'reset'], key: 'item-reset' },
  {
    haystack: ['storage', 'clear all session messages and reset the database'],
    key: 'tab-storage',
  },
];

const search = (query: string) =>
  createSettingsSearchFuse(entries)
    .search(query, { limit: MAX_SEARCH_RESULTS })
    .map((result) => result.item.key);

describe('createSettingsSearchFuse', () => {
  it('matches exact substrings', () => {
    expect(search('theme')).toContain('tab-appearance');
    expect(search('主题')).toContain('tab-appearance');
  });

  it('tolerates small typos', () => {
    expect(search('apearance')).toContain('tab-appearance');
    expect(search('thme')).toContain('tab-appearance');
  });

  it('ranks the exact match above fuzzy matches', () => {
    // `chongzhi` is exact for 充值 and edit-distance 1 from 重置's `zhongzhi` —
    // the fuzzy hit compensates the polyphone drift but must rank below.
    expect(search('chongzhi')).toEqual(['item-top-up', 'item-reset']);
  });

  it('matches deep inside long description texts', () => {
    expect(search('reset the database')).toContain('tab-storage');
  });

  it('returns nothing for unrelated queries', () => {
    expect(search('banana')).toEqual([]);
  });
});
