import { cleanup, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mapFeatureFlagsEnvToState } from '@/config/featureFlags';
import { SettingsTabs } from '@/store/global/initialState';
import { initServerConfigStore, Provider } from '@/store/serverConfig/store';
import { useUserStore } from '@/store/user';

import { SettingsGroupKey, useCategory } from './useCategory';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    },
  });
});

const navigate = vi.fn();
const mocks = vi.hoisted(() => ({ codingPlans: false }));

vi.mock('@/business/client/hooks/useCodingPlansTab', () => ({
  useCodingPlansTab: () => (mocks.codingPlans ? { label: 'Business tab' } : null),
}));

vi.mock('react-router', () => ({
  useNavigate: () => navigate,
}));

const createWrapper = (showProvider: boolean, enableBusinessFeatures = false) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Provider
      createStore={() =>
        initServerConfigStore({
          featureFlags: {
            ...mapFeatureFlagsEnvToState({
              provider_settings: true,
            }),
            showProvider,
          },
          serverConfig: { aiProvider: {}, enableBusinessFeatures, telemetry: {} },
        })
      }
    >
      {children}
    </Provider>
  );

  return Wrapper;
};

const initialUserStoreState = useUserStore.getState();

afterEach(() => {
  cleanup();
  navigate.mockReset();
  mocks.codingPlans = false;
  useUserStore.setState(initialUserStoreState, true);
});

describe('mobile settings useCategory', () => {
  it('keeps Provider visible and routes to the provider list when provider settings are enabled', () => {
    const { result } = renderHook(() => useCategory(), {
      wrapper: createWrapper(true),
    });

    const provider = result.current
      .flatMap((group) => group.items)
      .find((item) => item.key === SettingsTabs.Provider);

    const keys = result.current.flatMap((group) => group.items.map((item) => item.key));

    expect(provider).toBeDefined();
    expect(keys).not.toContain(SettingsTabs.OAuthApps);

    provider?.onClick?.();

    expect(navigate).toHaveBeenCalledWith('/settings/provider/all');
  });

  it('hides Provider when provider settings are disabled', () => {
    const { result } = renderHook(() => useCategory(), {
      wrapper: createWrapper(false),
    });

    const keys = result.current.flatMap((group) => group.items.map((item) => item.key));

    expect(keys).not.toContain(SettingsTabs.Provider);
  });

  it('shows OAuth Apps when the Labs preference is enabled', () => {
    useUserStore.setState({
      preference: {
        ...initialUserStoreState.preference,
        lab: { ...initialUserStoreState.preference.lab, enableOAuthApps: true },
      },
    });

    const { result } = renderHook(() => useCategory(), {
      wrapper: createWrapper(true),
    });

    const systemGroup = result.current.find((group) => group.key === SettingsGroupKey.System);

    expect(systemGroup?.items.map((item) => item.key)).toContain(SettingsTabs.OAuthApps);
  });

  it('lists Coding Plans under Runtime, right after Agent, only where the slot supplies it', () => {
    const groups = () =>
      renderHook(() => useCategory(), { wrapper: createWrapper(true, true) }).result.current;
    const keysOf = (key: SettingsGroupKey) =>
      groups()
        .find((group) => group.key === key)
        ?.items.map((item) => item.key);

    expect(groups().map((group) => group.key)).not.toContain(SettingsGroupKey.Resource);

    mocks.codingPlans = true;
    const order = groups().map((group) => group.key);
    // A real key: a missing enum member would make both sides `undefined`.
    expect(order).toContain('resource');
    expect(order.indexOf(SettingsGroupKey.Resource)).toBe(
      order.indexOf(SettingsGroupKey.Agent) + 1,
    );
    expect(keysOf(SettingsGroupKey.Resource)).toEqual([SettingsTabs.CodingPlans]);
    expect(keysOf(SettingsGroupKey.Subscription)).not.toContain(SettingsTabs.CodingPlans);
  });
});
