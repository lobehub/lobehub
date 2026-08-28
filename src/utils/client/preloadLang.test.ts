import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preloadLang } from './preloadLang';

const { getAntdLocale, load } = vi.hoisted(() => ({
  getAntdLocale: vi.fn(() => Promise.resolve({})),
  load: vi.fn(),
}));

vi.mock('i18next', () => ({
  changeLanguage: vi.fn(),
  default: {
    getDataByLanguage: () => ({ chat: {}, setting: {} }),
    language: 'en-US',
    options: { ns: ['common', 'chat'] },
    services: { backendConnector: { load } },
  },
}));

vi.mock('@/utils/locale', () => ({ getAntdLocale }));

describe('preloadLang', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should load the currently used namespaces after the hover intent delay', () => {
    preloadLang('zh-CN');

    expect(load).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(load).toHaveBeenCalledWith('zh-CN', ['common', 'chat', 'setting'], expect.any(Function));
    expect(getAntdLocale).toHaveBeenCalledWith('zh-CN');
  });

  it('should resolve "auto" to the system language so the preloaded bundle matches switchLang', () => {
    vi.stubGlobal('lobeEnv', { systemLanguage: 'ja-JP' });

    preloadLang('auto');
    vi.runAllTimers();

    expect(load).toHaveBeenCalledWith('ja-JP', ['common', 'chat', 'setting'], expect.any(Function));

    vi.unstubAllGlobals();
  });

  it('should only preload the last hovered locale when moving across items', () => {
    preloadLang('de-DE');
    preloadLang('fr-FR');
    preloadLang('ko-KR');

    vi.runAllTimers();

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('ko-KR', ['common', 'chat', 'setting'], expect.any(Function));
  });
});
