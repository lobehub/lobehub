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

const createWrapper = (showProvider: boolean, enableBusinessFeatures = false) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Provider
      createStore={() =>
        initServerConfigStore({
          serverConfig: { aiProvider: {}, enableBusinessFeatures, telemetry: {} },
          featureFlags: {
            ...mapFeatureFlagsEnvToState({
              provider_settings: true,
            }),
            showProvider,
          },
        })
      }
    >
      {children}
    </Provider>
  );

  return Wrapper;
};

const getItemKeys = () => {
  const { result } = renderHook(() => useCategory(), {
    wrapper: createWrapper(true),
  });

  return result.current.flatMap((group) => group.items.map((item) => item.key));
};

const initialUserStoreState = useUserStore.getState();

afterEach(() => {
  cleanup();
  useUserStore.setState(initialUserStoreState, true);
});

describe('settings useCategory', () => {
  it('orders business groups with account, connection and resource contents', () => {
    const { result } = renderHook(() => useCategory(), {
      wrapper: createWrapper(true, true),
    });

    const groupKeys = (key: SettingsGroupKey) =>
      result.current.find((group) => group.key === key)?.items.map((item) => item.key);

    expect(result.current.map((group) => group.key)).toEqual([
      SettingsGroupKey.Account,
      SettingsGroupKey.Subscription,
      SettingsGroupKey.Agent,
      SettingsGroupKey.Connection,
      SettingsGroupKey.Resource,
      SettingsGroupKey.System,
    ]);

    expect(groupKeys(SettingsGroupKey.Account)).toEqual([
      SettingsTabs.Profile,
      SettingsTabs.Appearance,
      SettingsTabs.Hotkey,
      SettingsTabs.Notification,
      SettingsTabs.Stats,
    ]);

    expect(groupKeys(SettingsGroupKey.Connection)).toEqual([
      SettingsTabs.Messenger,
      SettingsTabs.Integrations,
      SettingsTabs.Connector,
      SettingsTabs.Creds,
    ]);

    // The sandbox drives moved to Docs → Sandbox Storage; settings keep only the
    // environment definitions.
    const keys = groupKeys(SettingsGroupKey.Resource);
    expect(keys).toContain(SettingsTabs.Environments);
    expect(keys).not.toContain('drive');
  });

  // Messenger bots are LobeHub-operated and only configurable from the cloud
  // admin, so the tab is a dead end on self-hosted deployments.
  it('keeps Provider and hides Messenger and OAuth Apps by default', () => {
    const keys = getItemKeys();

    expect(keys).not.toContain(SettingsTabs.Messenger);
    expect(keys).toContain(SettingsTabs.Provider);
    expect(keys).not.toContain(SettingsTabs.OAuthApps);
  });

  it('hides Provider when provider settings are disabled', () => {
    const { result } = renderHook(() => useCategory(), {
      wrapper: createWrapper(false),
    });

    const keys = result.current.flatMap((group) => group.items.map((item) => item.key));

    expect(keys).not.toContain(SettingsTabs.Provider);
  });

  it('lists API Key once when both of its flags are on', () => {
    useUserStore.setState({
      preference: {
        ...initialUserStoreState.preference,
        general: { ...initialUserStoreState.preference.general, isDevMode: true },
      },
    });

    const { result } = renderHook(() => useCategory(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider
          createStore={() =>
            initServerConfigStore({
              featureFlags: { ...mapFeatureFlagsEnvToState({}), showApiKeyManage: true },
              serverConfig: { aiProvider: {}, telemetry: {} },
            })
          }
        >
          {children}
        </Provider>
      ),
    });
    const keys = result.current.flatMap((group) => group.items.map((item) => item.key));

    expect(keys.filter((key) => key === SettingsTabs.APIKey)).toHaveLength(1);
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
});
