import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const initialUserStoreState = useUserStore.getState();

const getItemKeys = () => {
  const { result } = renderHook(() => useWorkspaceSettingCategory());

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

    const { result } = renderHook(() => useWorkspaceSettingCategory());
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

  it('places API Key in the System group', () => {
    const { result } = renderHook(() => useWorkspaceSettingCategory());
    const adminGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.Admin,
    );
    const systemGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.System,
    );

    expect(systemGroup?.items.map((item) => item.key)).toContain(WorkspaceSettingsTabs.APIKey);
    expect(adminGroup?.items.map((item) => item.key)).not.toContain(WorkspaceSettingsTabs.APIKey);
  });

  it('exposes API Key settings to members', () => {
    mocks.canManageWorkspace = false;

    const itemKeys = getItemKeys();
    const { result } = renderHook(() => useWorkspaceSettingCategory());

    expect(result.current.some((group) => group.key === WorkspaceSettingsGroupKey.Admin)).toBe(
      false,
    );
    expect(itemKeys).toContain(WorkspaceSettingsTabs.APIKey);
  });

  // Viewers hold no `API_KEY_*` grant, so the tab would open onto a list
  // request that immediately 403s. Trash remains available as a read-only page.
  it('hides API Key from viewers and keeps Trash in the System group', () => {
    mocks.canCreateContent = false;
    mocks.canManageWorkspace = false;

    const { result } = renderHook(() => useWorkspaceSettingCategory());
    const systemGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.System,
    );

    expect(result.current.flatMap((group) => group.items.map((item) => item.key))).not.toContain(
      WorkspaceSettingsTabs.APIKey,
    );
    expect(systemGroup?.items.map((item) => item.key)).toEqual([WorkspaceSettingsTabs.Trash]);
  });

  it('keeps Trash visible to viewers in the System group', () => {
    mocks.canCreateContent = false;
    mocks.canManageWorkspace = false;
    mocks.canViewBilling = false;

    const { result } = renderHook(() => useWorkspaceSettingCategory());
    const systemGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.System,
    );

    expect(systemGroup?.items.map((item) => item.key)).toContain(WorkspaceSettingsTabs.Trash);
  });

  it('keeps the System group for viewers when OAuth Apps is enabled', () => {
    mocks.canCreateContent = false;
    mocks.canManageWorkspace = false;
    useUserStore.setState({
      preference: {
        ...initialUserStoreState.preference,
        lab: { ...initialUserStoreState.preference.lab, enableOAuthApps: true },
      },
    });

    const { result } = renderHook(() => useWorkspaceSettingCategory());
    const systemGroup = result.current.find(
      (group) => group.key === WorkspaceSettingsGroupKey.System,
    );

    expect(systemGroup?.items.map((item) => item.key)).toEqual([
      WorkspaceSettingsTabs.OAuthApps,
      WorkspaceSettingsTabs.Trash,
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
