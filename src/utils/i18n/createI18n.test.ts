// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const loadI18nNamespaceModule = vi.fn(async ({ lng, ns }: { lng: string; ns: string }) => ({
  default: {
    key: `${lng}:${ns}`,
  },
}));

vi.mock('./loadI18nNamespaceModule', () => ({
  loadI18nNamespaceModule,
}));

describe('createI18nNext', () => {
  it('initializes synchronously with bundled fallback resources and reloads the actual language in background', async () => {
    const { createI18nNext } = await import('@/locales/create');

    const i18n = createI18nNext('te-IN');
    const reloadSpy = vi.spyOn(i18n.instance, 'reloadResources');
    const initPromise = i18n.init({ initAsync: false });

    expect(i18n.instance.isInitialized).toBe(true);
    expect(i18n.instance.getResource('te-IN', 'common', 'copy')).toBeDefined();

    await initPromise;
    await Promise.resolve();
    await Promise.resolve();

    expect(i18n.instance.hasResourceBundle('te-IN', 'common')).toBe(true);
    expect(i18n.instance.hasResourceBundle('te-IN', 'chat')).toBe(true);
    expect(i18n.instance.hasResourceBundle('te-IN', 'error')).toBe(true);
    expect(i18n.instance.hasResourceBundle('te-IN', 'home')).toBe(true);

    expect(reloadSpy).toHaveBeenCalledWith(['te-IN'], ['chat', 'common', 'error', 'home']);
    expect(loadI18nNamespaceModule).toHaveBeenCalledWith(
      expect.objectContaining({ lng: 'te-IN', ns: 'common' }),
    );
    expect(loadI18nNamespaceModule).toHaveBeenCalledWith(
      expect.objectContaining({ lng: 'te-IN', ns: 'chat' }),
    );
    expect(loadI18nNamespaceModule).toHaveBeenCalledWith(
      expect.objectContaining({ lng: 'te-IN', ns: 'error' }),
    );
    expect(loadI18nNamespaceModule).toHaveBeenCalledWith(
      expect.objectContaining({ lng: 'te-IN', ns: 'home' }),
    );
  });
});
