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
  it('splits business groups into the account set and the personal space set', () => {
    const { result } = renderHook(() => useCategory(), {
      wrapper: createWrapper(true, true),
    });

    const groupKeys = (key: SettingsGroupKey) =>
      result.current.find((group) => group.key === key)?.items.map((item) => item.key);

    expect(result.current.map((group) => [group.key, group.scope])).toEqual([
      [SettingsGroupKey.Account, 'account'],
      [SettingsGroupKey.System, 'account'],
      [SettingsGroupKey.Subscription, 'space'],
      [SettingsGroupKey.Agent, 'space'],
      [SettingsGroupKey.Resource, 'space'],
      [SettingsGroupKey.Data, 'space'],
    ]);

    // Account settings follow the user across spaces.
    expect(groupKeys(SettingsGroupKey.Account)).toEqual([
      SettingsTabs.Profile,
      SettingsTabs.Appearance,
      SettingsTabs.Conversation,
      SettingsTabs.Hotkey,
      SettingsTabs.Notification,
      SettingsTabs.Memory,
      SettingsTabs.Referral,
    ]);
    // Advanced needs gateway mode or the desktop app.
    expect(groupKeys(SettingsGroupKey.System)).toEqual([SettingsTabs.Labs, SettingsTabs.About]);

    // The personal subscription is the personal space's, like a workspace's.
    expect(groupKeys(SettingsGroupKey.Subscription)).toEqual([
      SettingsTabs.Plans,
      SettingsTabs.Usage,
      SettingsTabs.Billing,
    ]);
    // Every Connection entry is behind the webhook flag, so the group is gone.
    expect(groupKeys(SettingsGroupKey.Connection)).toBeUndefined();
    expect(groupKeys(SettingsGroupKey.Data)).toEqual([
      SettingsTabs.Stats,
      SettingsTabs.Storage,
      SettingsTabs.Trash,
    ]);

    // Every tab has exactly one home.
    const allKeys = result.current.flatMap((group) => group.items.map((item) => item.key));
    expect(new Set(allKeys).size).toBe(allKeys.length);

    // Entries that moved out of settings must not come back: skills and
    // connectors live in Plugins, Messenger left settings, and credentials
    // share the Environments page.
    for (const removed of ['messenger', 'integrations', SettingsTabs.Creds])
      expect(allKeys).not.toContain(removed);
    expect(getItemKeys()).not.toContain(SettingsTabs.Skill);
    expect(getItemKeys()).not.toContain(SettingsTabs.Connector);

    // The sandbox drives moved to Docs → Sandbox Storage; settings keep only the
    // environment definitions.
    const keys = groupKeys(SettingsGroupKey.Resource);
    expect(keys).toContain(SettingsTabs.Environments);
    // Credentials share the Environments page: one entry for what a run starts
    // from and the secrets it reads.
    expect(keys).not.toContain(SettingsTabs.Creds);
    expect(keys).not.toContain('drive');
  });

  it('keeps Provider and hides Messenger and OAuth Apps by default', () => {
    const keys = getItemKeys();

    expect(keys).not.toContain('messenger');
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

  const renderWithApiKeyFlag = (showApiKeyManage: boolean) =>
    renderHook(() => useCategory(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider
          createStore={() =>
            initServerConfigStore({
              featureFlags: { ...mapFeatureFlagsEnvToState({}), showApiKeyManage },
              serverConfig: { aiProvider: {}, telemetry: {} },
            })
          }
        >
          {children}
        </Provider>
      ),
    }).result.current.flatMap((group) => group.items.map((item) => item.key));

  it('lists API Key once when the deployment enables it', () => {
    expect(renderWithApiKeyFlag(true).filter((key) => key === SettingsTabs.APIKey)).toHaveLength(1);
  });

  // The retired Advanced Tools switch used to reveal API Key past the
  // deployment flag; a value still stored for it must not.
  it('hides API Key when the deployment disables it, even with the retired switch stored', () => {
    useUserStore.setState({
      settings: { general: { isDevMode: true } },
    } as unknown as Parameters<typeof useUserStore.setState>[0]);

    expect(renderWithApiKeyFlag(false)).not.toContain(SettingsTabs.APIKey);
  });

  // With Advanced Tools gone, gateway mode is all Advanced holds on the web.
  it('lists Advanced on the web only when gateway mode is available', () => {
    const keysWithGateway = (enableGatewayMode: boolean) =>
      renderHook(() => useCategory(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <Provider
            createStore={() =>
              initServerConfigStore({
                featureFlags: mapFeatureFlagsEnvToState({}),
                serverConfig: { aiProvider: {}, enableGatewayMode, telemetry: {} },
              })
            }
          >
            {children}
          </Provider>
        ),
      }).result.current.flatMap((group) => group.items.map((item) => item.key));

    expect(keysWithGateway(false)).not.toContain(SettingsTabs.Advanced);
    expect(keysWithGateway(true)).toContain(SettingsTabs.Advanced);
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

describe('settings useCategory automations', () => {
  const connectionKeys = (enableWebhook: boolean) => {
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <Provider
        createStore={() =>
          initServerConfigStore({
            featureFlags: { ...mapFeatureFlagsEnvToState({}), enableWebhook },
            serverConfig: { aiProvider: {}, telemetry: {} },
          })
        }
      >
        {children}
      </Provider>
    );
    const { result } = renderHook(() => useCategory(), { wrapper: Wrapper });

    return result.current
      .find((group) => group.key === SettingsGroupKey.Connection)
      ?.items.map((item) => item.key);
  };

  // Unreleased: the tab follows the `webhook` flag (LOBE-UX-015).
  it('hides Automations while MCP Events is off', () => {
    expect(connectionKeys(false) ?? []).not.toContain(SettingsTabs.Automations);
  });

  it('keeps Automations and Webhooks now that connectors live in the Marketplace', () => {
    const keys = connectionKeys(true) ?? [];

    expect(keys).not.toContain(SettingsTabs.Connector);
    expect(keys).not.toContain('integrations');
    expect(keys.indexOf(SettingsTabs.Webhooks)).toBe(keys.indexOf(SettingsTabs.Automations) + 1);
  });
});
