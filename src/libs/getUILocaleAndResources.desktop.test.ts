import { describe, expect, it, vi } from 'vitest';

const moduleEvaluation = vi.hoisted(() => ({
  businessResources: vi.fn(),
  builtinResources: vi.fn(),
}));

vi.mock('/locales/zh-CN/ui.json', () => {
  moduleEvaluation.businessResources();

  return { default: { business: 'localized' } };
});

vi.mock('@lobehub/ui/es/i18n/resources/index', () => {
  moduleEvaluation.builtinResources();

  return {
    en: { app: { builtin: 'English' } },
    zhCn: { app: { builtin: '中文' } },
  };
});

describe('getUILocaleAndResources.desktop', () => {
  it('evaluates UI locale resources only when the locale is requested', async () => {
    const { getUILocaleAndResources } = await import('./getUILocaleAndResources.desktop');

    expect(moduleEvaluation.businessResources).not.toHaveBeenCalled();
    expect(moduleEvaluation.builtinResources).not.toHaveBeenCalled();

    const result = await getUILocaleAndResources('zh-CN');

    expect(result).toEqual({
      locale: 'zh-CN',
      resources: { app: { builtin: '中文', business: 'localized' } },
    });
    expect(moduleEvaluation.businessResources).toHaveBeenCalledOnce();
    expect(moduleEvaluation.builtinResources).toHaveBeenCalledOnce();
  });
});
