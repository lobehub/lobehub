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
      SettingsGroupKey.Resource,
      SettingsGroupKey.System,
    ]);

    expect(groupKeys(SettingsGroupKey.Account)).toEqual([
      SettingsTabs.Profile,
      SettingsTabs.Appearance,
      SettingsTabs.Conversation,
      SettingsTabs.Hotkey,
      SettingsTabs.Notification,
      SettingsTabs.Stats,
    ]);

    expect(groupKeys(SettingsGroupKey.Connection)).toBeUndefined();
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
