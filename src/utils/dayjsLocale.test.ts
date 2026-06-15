import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

import { loadDayjsLocaleModule, normalizeDayjsLocale } from './dayjsLocale';

const localeModule = {
  default: {
    formats: {},
    name: 'test',
    relativeTime: {},
  } satisfies ILocale,
};

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

describe('loadDayjsLocaleModule', () => {
  it('should load a lazy glob locale module', async () => {
    await expect(loadDayjsLocaleModule(() => Promise.resolve(localeModule))).resolves.toBe(
      localeModule,
    );
  });

  it('should return an eager glob locale module', async () => {
    await expect(loadDayjsLocaleModule(localeModule)).resolves.toBe(localeModule);
  });

  it('should load and apply a dayjs browser locale module', async () => {
    const previousLocale = dayjs.locale();
    const mod = await loadDayjsLocaleModule(
      () => import('dayjs/locale/zh-cn') as Promise<{ default: ILocale }>,
    );

    try {
      dayjs.locale(mod.default);

      expect(dayjs.locale()).toBe('zh-cn');
    } finally {
      dayjs.locale(previousLocale);
    }
  });
});
