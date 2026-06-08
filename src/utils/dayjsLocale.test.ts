import { describe, expect, it } from 'vitest';

import { normalizeDayjsLocale } from './dayjsLocale';

describe('normalizeDayjsLocale', () => {
  it('should normalize simplified Chinese script locales to zh-cn', () => {
    expect(normalizeDayjsLocale('zh-Hans')).toBe('zh-cn');
    expect(normalizeDayjsLocale('zh-Hans-CN')).toBe('zh-cn');
  });

  it('should normalize traditional Chinese script locales to zh-tw', () => {
    expect(normalizeDayjsLocale('zh-Hant')).toBe('zh-tw');
    expect(normalizeDayjsLocale('zh-Hant-TW')).toBe('zh-tw');
  });
});
