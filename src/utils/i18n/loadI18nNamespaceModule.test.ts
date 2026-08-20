import { describe, expect, it, vi } from 'vitest';

const loadBusinessI18nNamespace = vi.fn(async () => ({
  businessOnly: 'extension',
  shared: 'business',
}));

vi.mock('@/business/locales', () => ({
  loadBusinessI18nNamespace,
}));

describe('mergeBusinessI18nNamespace', () => {
  it('adds business entries and lets the implementation override shared keys', async () => {
    const { mergeBusinessI18nNamespace } = await import('./loadI18nNamespaceModule');
    const params = {
      defaultLang: 'en-US',
      lng: 'zh-CN',
      normalizeLocale: (locale?: string) => locale ?? 'en-US',
      ns: 'agent',
    };

    await expect(
      mergeBusinessI18nNamespace(
        {
          default: { baseOnly: 'base', shared: 'base' },
        },
        params,
      ),
    ).resolves.toEqual({
      default: {
        baseOnly: 'base',
        businessOnly: 'extension',
        shared: 'business',
      },
    });
    expect(loadBusinessI18nNamespace).toHaveBeenCalledWith(params);
  });
});
