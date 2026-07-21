import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { useUserStore } from '@/store/user';

import { useEffectiveAgencyConfig } from './useEffectiveAgencyConfig';

vi.mock('@/store/agent', () => ({ useAgentStore: vi.fn() }));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById:
      (id: string) => (s: { agentMap: Record<string, { agencyConfig?: unknown }> }) =>
        s.agentMap[id]?.agencyConfig,
    isWorkspaceAgentById:
      (id: string) => (s: { agentMap: Record<string, { workspaceId?: string }> }) =>
        Boolean(s.agentMap[id]?.workspaceId),
  },
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

const mockedUseAgentStore = vi.mocked(useAgentStore);
const mockedUseUserStore = vi.mocked(useUserStore);

const sharedConfig = { boundDeviceId: 'creator-device', executionTarget: 'device' as const };

const setupStores = ({
  agencyConfig = sharedConfig as unknown,
  fetchedPreference,
  isLoading = false,
  override,
  workspaceId,
}: {
  agencyConfig?: unknown;
  /** SWR response data — `undefined` = not yet resolved, `null` = no server row. */
  fetchedPreference?: unknown;
  isLoading?: boolean;
  override?: unknown;
  workspaceId?: string;
} = {}) => {
  const agentState = { agentMap: { 'agent-1': { agencyConfig, workspaceId } } };
  const userState = {
    useFetchWorkspaceUserPreference: () => ({ data: fetchedPreference, isLoading }),
    workspaceUserPreference: { agentDeviceOverrides: override ? { 'agent-1': override } : {} },
  };
  mockedUseAgentStore.mockImplementation((selector: any) => selector(agentState));
  mockedUseUserStore.mockImplementation((selector: any) => selector(userState));
};

describe('useEffectiveAgencyConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(result.current.isPreferenceLoading).toBe(false);
    expect(result.current.workspaceScoped).toBe(false);
  });
});
