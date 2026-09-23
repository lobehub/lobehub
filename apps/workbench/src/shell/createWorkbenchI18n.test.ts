import { describe, expect, it, vi } from 'vitest';

import { createWorkbenchI18n } from './createWorkbenchI18n';

vi.mock('@/utils/i18n/loadI18nNamespaceModule', () => ({
  loadI18nNamespaceModule: async ({ lng }: { lng: string }) => ({
    default: { 'acceptance.tabs.checks': lng === 'zh-CN' ? '检查清单' : 'Checklist' },
  }),
}));

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
});
