/**
 * @vitest-environment happy-dom
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { deviceService } from '@/services/device';
import { useDeviceStore } from '@/store/device';
import { initialState } from '@/store/device/initialState';
import { deviceListResource } from '@/store/device/projection';
import { useUserStore } from '@/store/user';

import { useRemoteAgentDeviceGuard } from './useRemoteAgentDeviceGuard';

vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({ useEffectiveAgencyConfig: vi.fn() }));
vi.mock('@/services/device', () => ({
  deviceService: { checkCapability: vi.fn(), listDevices: vi.fn() },
}));

const mockedUseEffectiveAgencyConfig = vi.mocked(useEffectiveAgencyConfig);
const mockedCheckCapability = vi.mocked(deviceService.checkCapability);
const mockedListDevices = vi.mocked(deviceService.listDevices);

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

const ROW_KEY = deviceListResource.storageKey({});

const bindCodexTo = (boundDeviceId: string) =>
  mockedUseEffectiveAgencyConfig.mockReturnValue({
    agencyConfig: {
      boundDeviceId,
      executionTarget: 'device',
      heterogeneousProvider: { type: 'codex' },
    },
    canDisplayExecutionTarget: true,
    canSelectExecutionTarget: true,
    isPreferenceLoading: false,
    workspaceScoped: false,
  });

describe('useRemoteAgentDeviceGuard', () => {
  let scope = '';

  beforeEach(() => {
    vi.clearAllMocks();
    scope = `guard-user-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => {
      useDeviceStore.setState(initialState);
      useUserStore.setState({ isSignedIn: true });
    });
  });

  afterEach(async () => {
    await deviceListResource.storage!.remove({ queryKey: ROW_KEY, scope });
    vi.restoreAllMocks();
  });

  it('reads the shared device list instead of requesting it again', async () => {
    bindCodexTo('my-device');
    mockedListDevices.mockResolvedValue([{ deviceId: 'my-device', online: true }] as never);

    const { result } = renderHook(
      () => {
        // The chat input's device switcher reads the same list next to the guard.
        useDeviceStore((s) => s.useFetchDevices)(true);
        return useRemoteAgentDeviceGuard({ agentId: 'agent-1' });
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(mockedListDevices).toHaveBeenCalledTimes(1);
  });

  it('treats a persisted row as unknown, not offline, until the server confirms it', async () => {
    bindCodexTo('my-device');
    await deviceListResource.storage!.set(
      { queryKey: ROW_KEY, scope },
      { data: [{ channels: [], deviceId: 'my-device', online: true }] as never, updatedAt: 1 },
    );
    let answer: (devices: never) => void = () => {};
    mockedListDevices.mockImplementation(() => new Promise((resolve) => (answer = resolve)));

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agentId: 'agent-1' }), {
      wrapper,
    });

    // The stored row reads `online: false`; that must not raise the offline banner.
    await waitFor(() =>
      expect(useDeviceStore.getState().deviceListMap.all?.[0]?.onlineUnknown).toBe(true),
    );
    expect(result.current.status).toBe('checking');

    act(() => answer([{ deviceId: 'my-device', online: true }] as never));
    await waitFor(() => expect(result.current.status).toBe('ok'));
  });

  it('allows sending when the device list cannot be read', async () => {
    bindCodexTo('my-device');
    mockedListDevices.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agentId: 'agent-1' }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.status).toBe('ok'));
  });

  it('allows sending when a refresh fails over a confirmed offline row', async () => {
    mockedUseEffectiveAgencyConfig.mockReturnValue({
      agencyConfig: {
        boundDeviceId: 'my-device',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'claude-code' },
      },
      canDisplayExecutionTarget: true,
      canSelectExecutionTarget: true,
      isPreferenceLoading: false,
      workspaceScoped: false,
    });
    mockedListDevices.mockResolvedValue([{ deviceId: 'my-device', online: false }] as never);

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agentId: 'agent-1' }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe('device-offline'));

    // A focus / manual re-check that cannot reach the server must not keep the
    // composer blocked on the earlier answer.
    mockedListDevices.mockRejectedValue(new Error('network down'));
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.status).toBe('ok'));
  });

  it('checks the EFFECTIVE bound device (with the caller override merged)', async () => {
    // The workspace-shared row points at the creator's (offline) machine; the
    // caller's override picks their own online device — the guard must probe
    // the override device, not the shared one.
    mockedUseEffectiveAgencyConfig.mockReturnValue({
      agencyConfig: {
        boundDeviceId: 'my-device',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'codex' },
      },
      canDisplayExecutionTarget: true,
      canSelectExecutionTarget: true,
      isPreferenceLoading: false,
      workspaceScoped: false,
    });
    mockedListDevices.mockResolvedValue([
      { deviceId: 'creator-device', online: false },
      { deviceId: 'my-device', online: true },
    ] as never);

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agentId: 'agent-1' }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.status).toBe('ok'));
  });

  it('reports device-offline when the effective bound device has no live channel', async () => {
    mockedUseEffectiveAgencyConfig.mockReturnValue({
      agencyConfig: {
        boundDeviceId: 'my-device',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'claude-code' },
      },
      canDisplayExecutionTarget: true,
      canSelectExecutionTarget: true,
      isPreferenceLoading: false,
      workspaceScoped: false,
    });
    mockedListDevices.mockResolvedValue([{ deviceId: 'my-device', online: false }] as never);

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agentId: 'agent-1' }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.status).toBe('device-offline'));
  });

  it('defers an unknown author-personal binding to authoritative server routing', async () => {
    mockedUseEffectiveAgencyConfig.mockReturnValue({
      agencyConfig: {
        boundDeviceId: 'author-device',
        heterogeneousProvider: { type: 'openclaw' },
      },
      canDisplayExecutionTarget: true,
      canSelectExecutionTarget: true,
      isPreferenceLoading: false,
      workspaceScoped: true,
    });
    mockedListDevices.mockResolvedValue([]);

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agentId: 'agent-1' }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(mockedCheckCapability).not.toHaveBeenCalled();
  });

  it('probes a personal device through the personal gateway principal', async () => {
    mockedUseEffectiveAgencyConfig.mockReturnValue({
      agencyConfig: {
        boundDeviceId: 'member-device',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'hermes' },
      },
      canDisplayExecutionTarget: true,
      canSelectExecutionTarget: true,
      isPreferenceLoading: false,
      workspaceScoped: false,
    });
    mockedListDevices.mockResolvedValue([
      { deviceId: 'member-device', online: true, scope: 'personal' },
    ] as never);
    mockedCheckCapability.mockResolvedValue({ available: true });

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agentId: 'agent-1' }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(mockedCheckCapability).toHaveBeenCalledWith({
      deviceId: 'member-device',
      platform: 'hermes',
      scope: 'personal',
    });
  });

  it('stays in checking (and does not probe) while the workspace preference loads', async () => {
    mockedUseEffectiveAgencyConfig.mockReturnValue({
      agencyConfig: {
        boundDeviceId: 'creator-device',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'codex' },
      },
      canDisplayExecutionTarget: true,
      canSelectExecutionTarget: true,
      isPreferenceLoading: true,
      workspaceScoped: true,
    });
    // The shared row's device reads offline — not this member's pick, so no banner.
    mockedListDevices.mockResolvedValue([{ deviceId: 'creator-device', online: false }] as never);

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agentId: 'agent-1' }), {
      wrapper,
    });

    await waitFor(() => expect(mockedListDevices).toHaveBeenCalled());
    await waitFor(() => expect(result.current.status).toBe('checking'));
    expect(mockedCheckCapability).not.toHaveBeenCalled();
  });

  it('reports no-device when nothing is bound', async () => {
    mockedUseEffectiveAgencyConfig.mockReturnValue({
      agencyConfig: { heterogeneousProvider: { type: 'codex' } },
      canDisplayExecutionTarget: true,
      canSelectExecutionTarget: true,
      isPreferenceLoading: false,
      workspaceScoped: false,
    });

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agentId: 'agent-1' }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.status).toBe('no-device'));
  });

  // A side-by-side portal pane pins its own device while the main column's
  // topic, still globally active, is bound elsewhere.
  it("checks the device bound to the conversation's own topic", async () => {
    mockedUseEffectiveAgencyConfig.mockImplementation((_agentId, options) => ({
      agencyConfig: {
        boundDeviceId: options?.topicId === 'pane-topic' ? 'pane-device' : 'main-device',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'codex' },
      },
      canDisplayExecutionTarget: true,
      canSelectExecutionTarget: true,
      isPreferenceLoading: false,
      workspaceScoped: false,
    }));
    mockedListDevices.mockResolvedValue([
      { deviceId: 'main-device', online: false },
      { deviceId: 'pane-device', online: true },
    ] as never);

    const { result } = renderHook(
      () => useRemoteAgentDeviceGuard({ agentId: 'agent-1', topicId: 'pane-topic' }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe('ok'));
  });
});
