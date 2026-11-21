import { cleanup, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initServerConfigStore, Provider } from '@/store/serverConfig/store';
import { useUserStore } from '@/store/user';
import { WorkspaceSettingsTabs } from '@/types/workspaceSettings';

import { useWorkspaceSettingCategory, WorkspaceSettingsGroupKey } from './useCategory';

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

const mocks = vi.hoisted(() => ({
  canCreateContent: true,
  canManageWorkspace: true,
  canViewBilling: true,
}));

const permissionFlags: Record<string, () => boolean> = {
  create_content: () => mocks.canCreateContent,
  view_billing: () => mocks.canViewBilling,
};

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: string) => ({
    allowed: permissionFlags[action]?.() ?? mocks.canManageWorkspace,
    reason: '',
  }),
}));

// The hook reads feature flags (`hideDocs`) from the server-config store,
// which only exists behind its Provider.
const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider createStore={() => initServerConfigStore({})}>{children}</Provider>
);

const wrapperWithMcpEvents = ({ children }: { children: ReactNode }) => (
  <Provider
    createStore={() => initServerConfigStore({ featureFlags: { enableWebhook: true } as never })}
  >
    {children}
  </Provider>
);

const initialUserStoreState = useUserStore.getState();

const getItemKeys = () => {
  const { result } = renderHook(() => useWorkspaceSettingCategory(), { wrapper });

  return result.current.flatMap((group) => group.items.map((item) => item.key));
};

beforeEach(() => {
  mocks.canCreateContent = true;
  mocks.canManageWorkspace = true;
  mocks.canViewBilling = true;
});

afterEach(() => {
  cleanup();
  useUserStore.setState(initialUserStoreState, true);
});

describe('workspace settings useCategory', () => {
  // Account-level tabs follow the user, not the workspace, so they are shown
  // to every role — including viewers with no workspace permissions.
  it('shows Account and System tabs without workspace permissions', () => {
    mocks.canCreateContent = false;
    mocks.canManageWorkspace = false;
    mocks.canViewBilling = false;

    const { result } = renderHook(() => useWorkspaceSettingCategory(), { wrapper });
    const accountGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.Account,
    );
    const generalGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.General,
    );

    expect(result.current[0]?.key).toBe(WorkspaceSettingsGroupKey.Account);
    expect(accountGroup?.items.map((item) => item.key)).toEqual([
      WorkspaceSettingsTabs.Profile,
      WorkspaceSettingsTabs.Appearance,
      WorkspaceSettingsTabs.Hotkey,
      WorkspaceSettingsTabs.ChatPreference,
    ]);
    expect(generalGroup?.items.map((item) => item.key)).not.toContain(
      WorkspaceSettingsTabs.Profile,
    );

    const systemGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.System,
    );

    expect(systemGroup?.items.map((item) => item.key)).toEqual([
      WorkspaceSettingsTabs.Trash,
      WorkspaceSettingsTabs.Advanced,
      WorkspaceSettingsTabs.Labs,
      WorkspaceSettingsTabs.About,
    ]);
    expect(result.current.at(-1)?.key).toBe(WorkspaceSettingsGroupKey.System);
  });

  it('groups devices, subscription accounts and environments & credentials under Runtime', () => {
    const { result } = renderHook(() => useWorkspaceSettingCategory(), { wrapper });
    const keys = result.current.map((group) => group.key);
    const resourceGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.Resource,
    );
    const generalGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.General,
    );

    expect(keys.indexOf(WorkspaceSettingsGroupKey.Subscription)).toBe(
      keys.indexOf(WorkspaceSettingsGroupKey.General) + 1,
    );
    const { result: withConnection } = renderHook(() => useWorkspaceSettingCategory(), {
      wrapper: wrapperWithMcpEvents,
    });
    const orderedKeys = withConnection.current.map((group) => group.key);
    expect(orderedKeys.indexOf(WorkspaceSettingsGroupKey.Resource)).toBe(
      orderedKeys.indexOf(WorkspaceSettingsGroupKey.Connection) + 1,
    );
    expect(resourceGroup?.items.map((item) => item.key)).toEqual([
      WorkspaceSettingsTabs.Devices,
      WorkspaceSettingsTabs.SubscriptionAccounts,
      // Credentials share the Environments page rather than an entry of their own.
      WorkspaceSettingsTabs.Environments,
    ]);
    expect(generalGroup?.items.map((item) => item.key)).not.toContain(
      WorkspaceSettingsTabs.Devices,
    );

    const adminGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.Admin,
    );
    const systemGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.System,
    );

    expect(systemGroup?.items.map((item) => item.key)).toContain(WorkspaceSettingsTabs.APIKey);
    expect(adminGroup?.items.map((item) => item.key)).not.toContain(WorkspaceSettingsTabs.APIKey);

    const itemKeys = result.current.flatMap((group) => group.items.map((item) => item.key));

    expect(itemKeys).not.toContain(WorkspaceSettingsTabs.OAuthApps);

    // Admin-or-higher reads the billing numbers; the pages keep the
    // money-moving controls behind the narrower manage_subscription gate.
    expect(itemKeys).toContain(WorkspaceSettingsTabs.Credits);
    expect(itemKeys).toContain(WorkspaceSettingsTabs.Billing);

    const connectionGroup = withConnection.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.Connection,
    );

    expect(connectionGroup?.items.map((item) => item.key)).not.toContain('integrations');
    expect(connectionGroup?.items.map((item) => item.key)).not.toContain(
      WorkspaceSettingsTabs.Creds,
    );
  });

  // Accounts are shared capacity every agent routes onto, so managing them is
  // an admin task like the other workspace infrastructure.
  it('hides Subscription Accounts below Admin', () => {
    mocks.canManageWorkspace = false;

    expect(getItemKeys()).not.toContain(WorkspaceSettingsTabs.SubscriptionAccounts);
    expect(getItemKeys()).toContain(WorkspaceSettingsTabs.Devices);
  });

  it('shows OAuth Apps when the Labs preference is enabled', () => {
    useUserStore.setState({
      preference: {
        ...initialUserStoreState.preference,
        lab: { ...initialUserStoreState.preference.lab, enableOAuthApps: true },
      },
    });

    const { result } = renderHook(() => useWorkspaceSettingCategory(), { wrapper });
    const systemGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.System,
    );
    const agentGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.Agent,
    );

    expect(systemGroup?.items.map((item) => item.key)).toContain(WorkspaceSettingsTabs.OAuthApps);
    expect(agentGroup?.items.map((item) => item.key)).not.toContain(
      WorkspaceSettingsTabs.OAuthApps,
    );
  });

  it('exposes API Key settings to members', () => {
    mocks.canManageWorkspace = false;

    const itemKeys = getItemKeys();
    const { result } = renderHook(() => useWorkspaceSettingCategory(), { wrapper });

    expect(result.current.some((group) => group.key === WorkspaceSettingsGroupKey.Admin)).toBe(
      false,
    );
    expect(itemKeys).toContain(WorkspaceSettingsTabs.APIKey);
  });

  // Viewers hold no `API_KEY_*` grant, so the tab would open onto a list
  // request that immediately 403s.
  it('hides API Key from viewers but keeps Advanced and Labs in the System group', () => {
    mocks.canCreateContent = false;
    mocks.canManageWorkspace = false;

    const { result } = renderHook(() => useWorkspaceSettingCategory(), { wrapper });
    const systemGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.System,
    );

    expect(systemGroup?.items.map((item) => item.key)).toEqual([
      WorkspaceSettingsTabs.Trash,
      WorkspaceSettingsTabs.Advanced,
      WorkspaceSettingsTabs.Labs,
      WorkspaceSettingsTabs.About,
    ]);
  });

  it('adds OAuth Apps to the viewer System group when the Labs preference is enabled', () => {
    mocks.canCreateContent = false;
    mocks.canManageWorkspace = false;
    useUserStore.setState({
      preference: {
        ...initialUserStoreState.preference,
        lab: { ...initialUserStoreState.preference.lab, enableOAuthApps: true },
      },
    });

    const { result } = renderHook(() => useWorkspaceSettingCategory(), { wrapper });
    const systemGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.System,
    );

    expect(systemGroup?.items.map((item) => item.key)).toEqual([
      WorkspaceSettingsTabs.Trash,
      WorkspaceSettingsTabs.Advanced,
      WorkspaceSettingsTabs.OAuthApps,
      WorkspaceSettingsTabs.Labs,
      WorkspaceSettingsTabs.About,
    ]);
  });

  it('hides financial settings below Admin', () => {
    mocks.canViewBilling = false;

    const itemKeys = getItemKeys();

    expect(itemKeys).not.toContain(WorkspaceSettingsTabs.Credits);
    expect(itemKeys).not.toContain(WorkspaceSettingsTabs.Billing);
    expect(itemKeys).toContain(WorkspaceSettingsTabs.Plans);
    expect(itemKeys).toContain(WorkspaceSettingsTabs.Usage);
  });
});

describe('workspace settings useCategory automations', () => {
  const connectionKeys = (withFlag: boolean) => {
    const { result } = renderHook(() => useWorkspaceSettingCategory(), {
      wrapper: withFlag ? wrapperWithMcpEvents : wrapper,
    });

    return result.current
      .find((group) => group.key === WorkspaceSettingsGroupKey.Connection)
      ?.items.map((item) => item.key);
  };

  // Unreleased: the tab follows the `webhook` flag (LOBE-UX-015).
  it('hides Automations, and the then-empty group, while MCP Events is off', () => {
    expect(connectionKeys(false)).toBeUndefined();
  });

  // Every role sees it: the list is how members learn what fires shared agents.
  it('lists Automations before Webhooks for every role', () => {
    mocks.canCreateContent = false;
    mocks.canManageWorkspace = false;
    mocks.canViewBilling = false;
    const keys = connectionKeys(true) ?? [];

    // Connectors moved to the Marketplace (`/:slug/marketplace/connector`).
    expect(keys).not.toContain(WorkspaceSettingsTabs.Connector);
    expect(keys).not.toContain('integrations');
    expect(keys.indexOf(WorkspaceSettingsTabs.Webhooks)).toBe(
      keys.indexOf(WorkspaceSettingsTabs.Automations) + 1,
    );
  });
});
