import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { deviceService } from '@/services/device';

import { useRemoteAgentDeviceGuard } from './useRemoteAgentDeviceGuard';

vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({ useEffectiveAgencyConfig: vi.fn() }));
vi.mock('@/services/device', () => ({
  deviceService: { checkCapability: vi.fn(), listDevices: vi.fn() },
}));

const mockedUseEffectiveAgencyConfig = vi.mocked(useEffectiveAgencyConfig);
const mockedCheckCapability = vi.mocked(deviceService.checkCapability);
const mockedListDevices = vi.mocked(deviceService.listDevices);

describe('useRemoteAgentDeviceGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agentId: 'agent-1' }));

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

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agentId: 'agent-1' }));

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

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agentId: 'agent-1' }));

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

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agentId: 'agent-1' }));

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

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agentId: 'agent-1' }));

    await waitFor(() => expect(result.current.status).toBe('checking'));
    expect(mockedListDevices).not.toHaveBeenCalled();
  });

  it('reports no-device when nothing is bound', async () => {
    mockedUseEffectiveAgencyConfig.mockReturnValue({
      agencyConfig: { heterogeneousProvider: { type: 'codex' } },
      canDisplayExecutionTarget: true,
      canSelectExecutionTarget: true,
      isPreferenceLoading: false,
      workspaceScoped: false,
    });

    const { result } = renderHook(() => useRemoteAgentDeviceGuard({ agentId: 'agent-1' }));

    await waitFor(() => expect(result.current.status).toBe('no-device'));
  });
});
