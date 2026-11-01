import { describe, expect, it, vi } from 'vitest';

const moduleEvaluation = vi.hoisted(() => ({
  defaultNamespace: vi.fn(),
  localizedNamespace: vi.fn(),
}));

vi.mock('/packages/locales/src/default/common.ts', () => {
  moduleEvaluation.defaultNamespace();

  return { default: { source: 'default' } };
});

vi.mock('/locales/zh-CN/common.json', () => {
  moduleEvaluation.localizedNamespace();

  return { default: { source: 'localized' } };
});

describe('loadI18nNamespaceModule.desktop', () => {
  it('evaluates only the requested locale namespace', async () => {
    const { loadI18nNamespaceModule } = await import('./loadI18nNamespaceModule.desktop');

    expect(moduleEvaluation.defaultNamespace).not.toHaveBeenCalled();
    expect(moduleEvaluation.localizedNamespace).not.toHaveBeenCalled();

    const result = await loadI18nNamespaceModule({
      defaultLang: 'en-US',
      lng: 'zh-CN',
      normalizeLocale: (locale) => locale ?? 'en-US',
      ns: 'common',
    });

    expect(result.default).toEqual({ source: 'localized' });
    expect(moduleEvaluation.localizedNamespace).toHaveBeenCalledOnce();
    expect(moduleEvaluation.defaultNamespace).not.toHaveBeenCalled();
  });
});
