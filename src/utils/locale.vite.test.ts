import { describe, expect, it, vi } from 'vitest';

const moduleEvaluation = vi.hoisted(() => ({
  english: vi.fn(),
  simplifiedChinese: vi.fn(),
}));

vi.mock('antd/es/locale/en_US.js', () => {
  moduleEvaluation.english();

  return { default: { locale: 'en' } };
});

vi.mock('antd/es/locale/zh_CN.js', () => {
  moduleEvaluation.simplifiedChinese();

  return { default: { locale: 'zh-cn' } };
});

describe('getAntdLocale.vite', () => {
  it('evaluates only the requested antd locale', async () => {
    const { getAntdLocale } = await import('./locale.vite');

    expect(moduleEvaluation.english).not.toHaveBeenCalled();
    expect(moduleEvaluation.simplifiedChinese).not.toHaveBeenCalled();

    await expect(getAntdLocale('zh-CN')).resolves.toEqual({ locale: 'zh-cn' });
    expect(moduleEvaluation.simplifiedChinese).toHaveBeenCalledOnce();
    expect(moduleEvaluation.english).not.toHaveBeenCalled();
  });
});
