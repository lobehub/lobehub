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
  it('mirrors the account-level tabs in a leading Account group for every role', () => {
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
      WorkspaceSettingsTabs.Messenger,
    ]);
    expect(generalGroup?.items.map((item) => item.key)).not.toContain(
      WorkspaceSettingsTabs.Profile,
    );
  });

  it('shows About in a System group for every role', () => {
    mocks.canCreateContent = false;
    mocks.canManageWorkspace = false;
    mocks.canViewBilling = false;

    const { result } = renderHook(() => useWorkspaceSettingCategory(), { wrapper });
    const systemGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.System,
    );

    expect(systemGroup?.items.map((item) => item.key)).toEqual([WorkspaceSettingsTabs.About]);
    expect(result.current.map((group) => group.key).slice(-2)).toEqual([
      WorkspaceSettingsGroupKey.System,
      WorkspaceSettingsGroupKey.Developer,
    ]);
  });

  it('hides OAuth Apps by default', () => {
    expect(getItemKeys()).not.toContain(WorkspaceSettingsTabs.OAuthApps);
  });

  it('shows OAuth Apps when the Labs preference is enabled', () => {
    useUserStore.setState({
      preference: {
        ...initialUserStoreState.preference,
        lab: { ...initialUserStoreState.preference.lab, enableOAuthApps: true },
      },
    });

    const { result } = renderHook(() => useWorkspaceSettingCategory(), { wrapper });
    const developerGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.Developer,
    );
    const agentGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.Agent,
    );

    expect(developerGroup?.items.map((item) => item.key)).toContain(
      WorkspaceSettingsTabs.OAuthApps,
    );
    expect(agentGroup?.items.map((item) => item.key)).not.toContain(
      WorkspaceSettingsTabs.OAuthApps,
    );
  });

  it('places API Key in the Developer group', () => {
    const { result } = renderHook(() => useWorkspaceSettingCategory(), { wrapper });
    const adminGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.Admin,
    );
    const developerGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.Developer,
    );

    expect(developerGroup?.items.map((item) => item.key)).toContain(WorkspaceSettingsTabs.APIKey);
    expect(adminGroup?.items.map((item) => item.key)).not.toContain(WorkspaceSettingsTabs.APIKey);
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
  it('hides API Key from viewers but keeps Advanced and Labs in the Developer group', () => {
    mocks.canCreateContent = false;
    mocks.canManageWorkspace = false;

    const { result } = renderHook(() => useWorkspaceSettingCategory(), { wrapper });
    const developerGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.Developer,
    );

    expect(developerGroup?.items.map((item) => item.key)).toEqual([
      WorkspaceSettingsTabs.Advanced,
      WorkspaceSettingsTabs.Labs,
    ]);
  });

  it('adds OAuth Apps to the viewer Developer group when the Labs preference is enabled', () => {
    mocks.canCreateContent = false;
    mocks.canManageWorkspace = false;
    useUserStore.setState({
      preference: {
        ...initialUserStoreState.preference,
        lab: { ...initialUserStoreState.preference.lab, enableOAuthApps: true },
      },
    });

    const { result } = renderHook(() => useWorkspaceSettingCategory(), { wrapper });
    const developerGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.Developer,
    );

    expect(developerGroup?.items.map((item) => item.key)).toEqual([
      WorkspaceSettingsTabs.Advanced,
      WorkspaceSettingsTabs.OAuthApps,
      WorkspaceSettingsTabs.Labs,
    ]);
  });

  // Admin-or-higher reads the billing numbers; the pages keep the
  // money-moving controls behind the narrower manage_subscription gate.
  it('shows Credits and Billing to roles that may view billing', () => {
    const itemKeys = getItemKeys();

    expect(itemKeys).toContain(WorkspaceSettingsTabs.Credits);
    expect(itemKeys).toContain(WorkspaceSettingsTabs.Billing);
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
