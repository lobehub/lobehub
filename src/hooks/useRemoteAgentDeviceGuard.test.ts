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
const mockedListDevices = vi.mocked(deviceService.listDevices);

describe('useRemoteAgentDeviceGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks the EFFECTIVE bound device (with the caller override merged)', async () => {
    // The workspace-shared row points at the creator's (offline) machine; the
    // caller's override picks their own online device — the guard must probe
    // the override device, not the shared one (LOBE-11904).
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
