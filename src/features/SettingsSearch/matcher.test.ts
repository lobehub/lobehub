import { describe, expect, it } from 'vitest';

import {
  createSettingsSearchFuse,
  MAX_SEARCH_RESULTS,
  searchSettingsIndex,
  tokenizeSettingsQuery,
} from './matcher';

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
  { haystack: ['api', 'api key', 'apikey'], key: 'tab-agent-apikey' },
  { haystack: ['provider', 'model', 'api', 'model provider'], key: 'tab-agent-provider' },
  { haystack: ['newapi', 'new api'], key: 'provider-newapi' },
  { haystack: ['search1api'], key: 'provider-search1api' },
  { haystack: ['tts', 'voice', 'speech'], key: 'item-service-model-tts' },
];

const fuse = createSettingsSearchFuse(entries);

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

describe('tokenizeSettingsQuery', () => {
  it('splits on spaces', () => {
    expect(tokenizeSettingsQuery('model provider')).toEqual(['model', 'provider']);
  });

  it('splits latin/CJK compounds', () => {
    expect(tokenizeSettingsQuery('tts设置')).toEqual(['tts', '设置']);
  });

  it('drops single-character tokens', () => {
    expect(tokenizeSettingsQuery('a api')).toEqual(['api']);
  });
});

describe('searchSettingsIndex', () => {
  it('keeps tab and item hits above provider-name collisions for generic tokens', () => {
    const keys = searchSettingsIndex(fuse, 'api').map((entry) => entry.key);

    expect(keys[0]).toBe('tab-agent-apikey');
    expect(keys).toContain('tab-agent-provider');
    expect(keys.indexOf('tab-agent-apikey')).toBeLessThan(keys.indexOf('provider-newapi'));
    expect(keys.indexOf('tab-agent-provider')).toBeLessThan(keys.indexOf('provider-newapi'));
  });

  it('does not demote a provider when the query is its name', () => {
    expect(searchSettingsIndex(fuse, 'newapi').map((entry) => entry.key)[0]).toBe(
      'provider-newapi',
    );
  });

  it('matches a multi-word query against per-field keywords', () => {
    expect(searchSettingsIndex(fuse, 'model provider').map((entry) => entry.key)).toContain(
      'tab-agent-provider',
    );
  });

  it('falls back to the latin token in a CJK compound like tts设置', () => {
    expect(searchSettingsIndex(fuse, 'tts设置').map((entry) => entry.key)).toContain(
      'item-service-model-tts',
    );
  });
});
