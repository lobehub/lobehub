import type { InitOptions } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { emit, init, on, reloadResources, storeOn, use } = vi.hoisted(() => ({
  emit: vi.fn(),
  init: vi.fn((_options: InitOptions) => Promise.resolve()),
  on: vi.fn(),
  reloadResources: vi.fn(() => Promise.resolve()),
  storeOn: vi.fn(),
  use: vi.fn(),
}));

vi.mock('i18next', () => {
  const instance: any = {
    emit,
    init,
    language: 'zh-CN',
    on,
    reloadResources,
    store: { on: storeOn },
    use: (...args: unknown[]) => {
      use(...args);
      return instance;
    },
  };
  return { default: instance };
});
vi.mock('i18next-browser-languagedetector', () => ({ default: {} }));
vi.mock('i18next-resources-to-backend', () => ({ default: () => ({}) }));
vi.mock('react-i18next', () => ({ initReactI18next: {} }));

const { createI18nNext } = await import('./create');

describe('createI18nNext', () => {
  beforeEach(() => {
    init.mockClear();
    emit.mockClear();
    reloadResources.mockClear();
  });

  it('does not bind every consumer to the resource store', () => {
    createI18nNext('zh-CN').init();

    // `bindI18nStore: 'added'` re-renders every `useTranslation` consumer once per
    // lazily-loaded bundle — ~30 full-tree passes during boot.
    expect(init.mock.calls[0]![0].react).not.toHaveProperty('bindI18nStore');
  });

  it('emits one languageChanged after the fallback resources are replaced', async () => {
    await createI18nNext('zh-CN').init();
    await vi.waitFor(() => expect(reloadResources).toHaveBeenCalled());

    expect(emit).toHaveBeenCalledWith('languageChanged', 'zh-CN');
    expect(emit.mock.calls.filter(([event]) => event === 'languageChanged')).toHaveLength(1);
  });

  it('skips the refresh when the app already runs the default language', async () => {
    await createI18nNext('en-US').init();
    await new Promise((r) => setTimeout(r, 0));

    expect(reloadResources).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
