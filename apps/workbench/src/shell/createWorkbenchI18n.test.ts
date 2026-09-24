import { describe, expect, it, vi } from 'vitest';

import { createWorkbenchI18n } from './createWorkbenchI18n';

vi.mock('@/utils/i18n/loadI18nNamespaceModule', () => ({
  loadI18nNamespaceModule: async ({ lng }: { lng: string }) => ({
    default: {
      'acceptance.tabs.checks':
        lng === 'zh-CN' ? '检查清单' : lng === 'ja-JP' ? 'チェックリスト' : 'Checklist',
    },
  }),
}));

const delayFirstNamespaceLoad = (i18n: ReturnType<typeof createWorkbenchI18n>) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loadNamespaces = i18n.instance.loadNamespaces.bind(i18n.instance);
  let loadCount = 0;
  vi.spyOn(i18n.instance, 'loadNamespaces').mockImplementation(async (...args) => {
    if (loadCount++ === 0) await gate;

    return loadNamespaces(...args);
  });

  return release;
};

describe('workbench live locale changes', () => {
  it('loads translated report labels when changing away from bundled SSR resources', async () => {
    const i18n = createWorkbenchI18n('en-US', {
      verify: { 'acceptance.tabs.checks': 'Checklist' },
    });
    const initialized = i18n.init({ initAsync: false });
    expect(i18n.instance.isInitialized).toBe(true);
    await initialized;
    expect(i18n.instance.t('acceptance.tabs.checks')).toBe('Checklist');
    await i18n.changeLanguage('zh-CN');
    expect(i18n.instance.t('acceptance.tabs.checks')).toBe('检查清单');
    await i18n.changeLanguage('en-US');
    expect(i18n.instance.t('acceptance.tabs.checks')).toBe('Checklist');
  });

  it('keeps the latest bundled locale when an earlier locale load finishes later', async () => {
    const i18n = createWorkbenchI18n('en-US', {
      verify: { 'acceptance.tabs.checks': 'Checklist' },
    });
    await i18n.init({ initAsync: false });
    const finishChinese = delayFirstNamespaceLoad(i18n);

    const chinese = i18n.changeLanguage('zh-CN');
    const english = i18n.changeLanguage('en-US');
    await english;
    finishChinese();
    await chinese;

    expect(i18n.instance.language).toBe('en-US');
    expect(i18n.instance.t('acceptance.tabs.checks')).toBe('Checklist');
  });

  it('keeps the latest locale when asynchronous locale loads finish out of order', async () => {
    const i18n = createWorkbenchI18n('en-US', {
      verify: { 'acceptance.tabs.checks': 'Checklist' },
    });
    await i18n.init({ initAsync: false });
    const finishChinese = delayFirstNamespaceLoad(i18n);

    const chinese = i18n.changeLanguage('zh-CN');
    const japanese = i18n.changeLanguage('ja-JP');
    await japanese;
    finishChinese();
    await chinese;

    expect(i18n.instance.language).toBe('ja-JP');
    expect(i18n.instance.t('acceptance.tabs.checks')).toBe('チェックリスト');
  });
});
