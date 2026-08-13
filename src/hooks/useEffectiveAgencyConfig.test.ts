import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import { useEffectiveAgencyConfig } from './useEffectiveAgencyConfig';

const managementAccess = vi.hoisted(() => ({
  canManageAgent: false,
  isAccessLoading: false,
}));
const projection = vi.hoisted(() => ({ agent: undefined as Record<string, unknown> | undefined }));

vi.mock('@/features/ResourcePermission/useAgentManagementAccess', () => ({
  useAgentManagementAccess: () => managementAccess,
}));

vi.mock('@/store/agent/projection', () => ({
  useAgentData: (id?: string) => (id === 'agent-1' ? projection.agent : undefined),
}));
vi.mock('@/store/user', () => ({ useUserStore: vi.fn() }));
vi.mock('@/store/user/selectors', () => ({
  workspaceUserSettingsSelectors: {
    agentDeviceOverrideById:
      (id: string) =>
      (s: { workspaceUserPreference: { agentDeviceOverrides?: Record<string, unknown> } }) =>
        s.workspaceUserPreference.agentDeviceOverrides?.[id],
  },
}));

const mockedUseUserStore = vi.mocked(useUserStore);

const sharedConfig = { boundDeviceId: 'creator-device', executionTarget: 'device' as const };

const setupStores = ({
  agencyConfig = sharedConfig as unknown,
  fetchedPreference,
  isLoading = false,
  override,
  visibility,
  workspaceId,
}: {
  agencyConfig?: unknown;
  /** SWR response data — `undefined` = not yet resolved, `null` = no server row. */
  fetchedPreference?: unknown;
  isLoading?: boolean;
  override?: unknown;
  visibility?: 'private' | 'public';
  workspaceId?: string;
} = {}) => {
  projection.agent = { agencyConfig, id: 'agent-1', visibility, workspaceId };
  const userState = {
    useFetchWorkspaceUserPreference: () => ({ data: fetchedPreference, isLoading }),
    workspaceUserPreference: { agentDeviceOverrides: override ? { 'agent-1': override } : {} },
  };
  mockedUseUserStore.mockImplementation((selector: any) => selector(userState));
};

describe('useEffectiveAgencyConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projection.agent = undefined;
    managementAccess.canManageAgent = false;
    managementAccess.isAccessLoading = false;
  });

  it('returns the shared config as-is for personal agents, ignoring any override', () => {
    setupStores({ override: { boundDeviceId: 'my-device', executionTarget: 'device' } });

    const { result } = renderHook(() => useEffectiveAgencyConfig('agent-1'));

    expect(result.current.agencyConfig).toEqual(sharedConfig);
    expect(result.current.workspaceScoped).toBe(false);
  });

  it('merges the caller override over the shared config for workspace agents', () => {
    setupStores({
      override: { boundDeviceId: 'my-device', executionTarget: 'local' },
      workspaceId: 'ws-1',
    });

    const { result } = renderHook(() => useEffectiveAgencyConfig('agent-1'));

    expect(result.current.agencyConfig).toEqual({
      boundDeviceId: 'my-device',
      executionTarget: 'local',
    });
    expect(result.current.workspaceScoped).toBe(false);
  });

  it('falls back to the shared config when a workspace agent has no override', () => {
    setupStores({ workspaceId: 'ws-1' });

    const { result } = renderHook(() => useEffectiveAgencyConfig('agent-1'));

    expect(result.current.agencyConfig).toEqual(sharedConfig);
    expect(result.current.workspaceScoped).toBe(true);
  });

  it('ignores member overrides and policy while the Workspace Agent is private', () => {
    setupStores({
      agencyConfig: {
        boundDeviceId: 'owner-device',
        executionTarget: 'device',
        executionTargetSelectionPolicy: 'fixed',
      },
      isLoading: true,
      override: { boundDeviceId: 'member-device', executionTarget: 'local' },
      visibility: 'private',
      workspaceId: 'ws-1',
    });

    const { result } = renderHook(() => useEffectiveAgencyConfig('agent-1'));

    expect(result.current).toEqual({
      agencyConfig: { boundDeviceId: 'owner-device', executionTarget: 'device' },
      canDisplayExecutionTarget: true,
      canSelectExecutionTarget: true,
      isPreferenceLoading: false,
      workspaceScoped: false,
    });
  });

  it('ignores member overrides and policy for the author or Workspace admin', () => {
    managementAccess.canManageAgent = true;
    setupStores({
      agencyConfig: {
        boundDeviceId: 'shared-device',
        executionTarget: 'device',
        executionTargetSelectionPolicy: 'fixed',
      },
      override: { boundDeviceId: 'member-device', executionTarget: 'local' },
      visibility: 'public',
      workspaceId: 'ws-1',
    });

    const { result } = renderHook(() => useEffectiveAgencyConfig('agent-1'));

    expect(result.current).toEqual({
      agencyConfig: { boundDeviceId: 'shared-device', executionTarget: 'device' },
      canDisplayExecutionTarget: true,
      canSelectExecutionTarget: true,
      isPreferenceLoading: false,
      workspaceScoped: false,
    });
  });

  it('shows a read-only execution summary when an ordinary member is fixed to the shared target', () => {
    setupStores({
      agencyConfig: {
        boundDeviceId: 'shared-device',
        executionTarget: 'device',
        executionTargetSelectionPolicy: 'fixed',
      },
      visibility: 'public',
      workspaceId: 'ws-1',
    });

    const { result } = renderHook(() => useEffectiveAgencyConfig('agent-1'));

    expect(result.current).toMatchObject({
      canDisplayExecutionTarget: true,
      canSelectExecutionTarget: false,
    });
  });

  it('preserves workspace scope when an override has no explicit execution target', () => {
    setupStores({ override: { boundDeviceId: 'my-device' }, workspaceId: 'ws-1' });

    const { result } = renderHook(() => useEffectiveAgencyConfig('agent-1'));

    expect(result.current.agencyConfig?.boundDeviceId).toBe('my-device');
    expect(result.current.workspaceScoped).toBe(true);
  });

  it('reports preference loading only for workspace agents', () => {
    setupStores({ isLoading: true, workspaceId: 'ws-1' });
    const workspaceResult = renderHook(() => useEffectiveAgencyConfig('agent-1'));
    expect(workspaceResult.result.current.isPreferenceLoading).toBe(true);
    expect(workspaceResult.result.current.canDisplayExecutionTarget).toBe(false);
    expect(workspaceResult.result.current.canSelectExecutionTarget).toBe(false);

    setupStores({ isLoading: true });
    const personalResult = renderHook(() => useEffectiveAgencyConfig('agent-1'));
    expect(personalResult.result.current.isPreferenceLoading).toBe(false);
  });

  it('prefers the SWR preference over the (possibly stale) store bucket', () => {
    // Switch-back window: SWR serves the cached CURRENT workspace preference
    // while the un-keyed store bucket still holds the previous workspace's.
    setupStores({
      fetchedPreference: {
        agentDeviceOverrides: {
          'agent-1': { boundDeviceId: 'my-device', executionTarget: 'device' },
        },
      },
      override: { boundDeviceId: 'stale-other-ws-device', executionTarget: 'device' },
      workspaceId: 'ws-1',
    });

    const { result } = renderHook(() => useEffectiveAgencyConfig('agent-1'));

    expect(result.current.agencyConfig?.boundDeviceId).toBe('my-device');
  });

  it('treats a null SWR response (no server row) as no override', () => {
    setupStores({
      fetchedPreference: null,
      override: { boundDeviceId: 'stale-other-ws-device', executionTarget: 'device' },
      workspaceId: 'ws-1',
    });

    const { result } = renderHook(() => useEffectiveAgencyConfig('agent-1'));

    expect(result.current.agencyConfig).toEqual(sharedConfig);
  });

  it('returns undefined config when agentId is missing', () => {
    setupStores({ override: { boundDeviceId: 'my-device' }, workspaceId: 'ws-1' });

    const { result } = renderHook(() => useEffectiveAgencyConfig(undefined));

    expect(result.current.agencyConfig).toBeUndefined();
    expect(result.current.canDisplayExecutionTarget).toBe(false);
    expect(result.current.canSelectExecutionTarget).toBe(false);
    expect(result.current.isPreferenceLoading).toBe(false);
    expect(result.current.workspaceScoped).toBe(false);
  });
});
