import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useFetchInstalledPlugins } from './useFetchInstalledPlugins';

const store = vi.hoisted(() => ({
  isConnectorsInit: false,
  useFetchConnectors: vi.fn(),
  useFetchInstalledPlugins: vi.fn(() => ({ isLoading: false })),
}));

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

describe('useFetchInstalledPlugins', () => {
  // `isPluginInstalled` reads plugin rows and connector installs: a view that
  // shows install state must load both, or a connector-only install reads as
  // not installed after a reload
  it('loads the connector list along with the installed plugin rows', () => {
    renderHook(() => useFetchInstalledPlugins());

    expect(store.useFetchInstalledPlugins).toHaveBeenCalledWith(true);
    expect(store.useFetchConnectors).toHaveBeenCalledWith(true);
  });
});
