import { describe, expect, it } from 'vitest';

import { loadI18nNamespaceModule } from './loadI18nNamespaceModule.client';

describe('workbench model runtime translations', () => {
  it.each(['en-US', 'zh-CN'])('loads error messages for %s', async (lng) => {
    const module = await loadI18nNamespaceModule({
      defaultLang: 'en-US',
      lng,
      normalizeLocale: (locale) => locale ?? 'en-US',
      ns: 'modelRuntime',
    });

    expect(module.default.ModelEmptyCompletion).toEqual(expect.any(String));
    if (lng === 'zh-CN') expect(module.default.ModelEmptyCompletion).toMatch(/[\u4E00-\u9FFF]/);
  });
});
