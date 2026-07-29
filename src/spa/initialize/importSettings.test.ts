/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  importUrlShareSettings: vi.fn(),
  isUserStateInit: false,
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('@/const/url', () => ({
  LOBE_URL_IMPORT_NAME: 'settings',
}));

vi.mock('@/store/user', () => ({
  getUserStoreState: () => ({
    importUrlShareSettings: mocks.importUrlShareSettings,
    isUserStateInit: mocks.isUserStateInit,
  }),
  useUserStore: {
    subscribe: mocks.subscribe,
  },
}));

describe('startImportSettingsFromUrl', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.isUserStateInit = false;
    mocks.subscribe.mockReturnValue(mocks.unsubscribe);
    window.history.replaceState({}, '', '/');
  });

  it('imports settings once user state is ready and removes the URL param', async () => {
    window.history.replaceState({}, '', '/agent/a?settings=encoded&foo=bar#hash');

    const { startImportSettingsFromUrl } = await import('./importSettings');
    startImportSettingsFromUrl();

    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/agent/a?foo=bar#hash',
    );
    expect(mocks.importUrlShareSettings).not.toHaveBeenCalled();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);

    const listener = mocks.subscribe.mock.calls[0]![1] as () => void;
    mocks.isUserStateInit = true;
    listener();

    expect(mocks.importUrlShareSettings).toHaveBeenCalledWith('encoded');
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('imports immediately when user state is already ready', async () => {
    mocks.isUserStateInit = true;
    window.history.replaceState({}, '', '/?settings=encoded');

    const { startImportSettingsFromUrl } = await import('./importSettings');
    startImportSettingsFromUrl();

    expect(mocks.importUrlShareSettings).toHaveBeenCalledWith('encoded');
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });
});
