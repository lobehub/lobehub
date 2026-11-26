import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';

import { useSettingsIndexUrl } from './useSettingsIndexUrl';

const mocks = vi.hoisted(() => ({ groups: [] as any[], serverConfigInit: false }));

vi.mock('./useCategory', () => ({
  useCategory: () => mocks.groups,
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (s: { serverConfigInit: boolean }) => unknown) =>
    selector({ serverConfigInit: mocks.serverConfigInit }),
}));

describe('useSettingsIndexUrl', () => {
  // Cold Electron load: flags arrive after the first render, and Plans only
  // appears once they do. Redirecting on that first render would pick the
  // wrong tab for the whole load.
  it('waits for the server config, then picks the first space tab it reveals', () => {
    mocks.serverConfigInit = false;
    mocks.groups = [
      { items: [{ key: SettingsTabs.Profile }], scope: 'account' },
      { items: [{ key: SettingsTabs.ServiceModel }], scope: 'space' },
    ];

    const { rerender, result } = renderHook(() => useSettingsIndexUrl());

    expect(result.current).toBeUndefined();

    mocks.serverConfigInit = true;
    mocks.groups = [
      { items: [{ key: SettingsTabs.Profile }], scope: 'account' },
      { items: [{ key: SettingsTabs.Plans }], scope: 'space' },
      { items: [{ key: SettingsTabs.ServiceModel }], scope: 'space' },
    ];
    rerender();

    expect(result.current).toBe('/settings/plans');
  });
});
