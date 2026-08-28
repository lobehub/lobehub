import { describe, expect, it, vi } from 'vitest';

// A business overlay revision that predates the optional
// `loadBusinessI18nNamespace` slot — the merge must degrade to the base
// namespace instead of failing (see mergeBusinessI18nNamespace.ts).
vi.mock('@/business/locales', () => ({
  loadBusinessI18nNamespace: undefined,
}));

describe('mergeBusinessI18nNamespace without the business slot', () => {
  it('returns the base namespace untouched', async () => {
    const { mergeBusinessI18nNamespace } = await import('./mergeBusinessI18nNamespace');

    await expect(
      mergeBusinessI18nNamespace(
        { default: { baseOnly: 'base' } },
        {
          defaultLang: 'en-US',
          lng: 'zh-CN',
          normalizeLocale: (locale?: string) => locale ?? 'en-US',
          ns: 'agent',
        },
      ),
    ).resolves.toEqual({ default: { baseOnly: 'base' } });
  });
});
