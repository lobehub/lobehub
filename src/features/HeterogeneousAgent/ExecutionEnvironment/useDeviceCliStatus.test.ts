import type { DeviceListItem } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceService } from '@/services/device';
import * as deviceList from '@/store/device/useDeviceList';

import { useDeviceCliStatus } from './useDeviceCliStatus';

const linuxDevice = {
  channels: [],
  deviceId: 'device-us-1',
  friendlyName: 'US Node 1',
  online: true,
  platform: 'linux',
  scope: 'personal',
} as unknown as DeviceListItem;

const refreshDevices = vi.fn();

const mockDevices = (devices: DeviceListItem[]) =>
  vi.spyOn(deviceList, 'useDeviceList').mockReturnValue({
    data: devices,
    error: undefined,
    isConfirmed: true,
    isLoading: false,
    isValidating: false,
    mutate: refreshDevices,
  });

// A fresh SWR cache per test, so one test's scan never answers another's.
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const renderStatus = () =>
  renderHook(() => useDeviceCliStatus({ agentType: 'claude-code', deviceId: 'device-us-1' }), {
    wrapper,
  });

describe('useDeviceCliStatus', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshDevices.mockReset();
  });

  it('scans the bound device and reports the CLI missing there', async () => {
    mockDevices([linuxDevice]);
    const scanAgents = vi
      .spyOn(deviceService, 'scanAgents')
      .mockResolvedValue({ agents: { 'claude-code': { available: false } } });

    const { result } = renderStatus();

    await waitFor(() => expect(result.current.state).toEqual({ status: 'unavailable' }));
    expect(scanAgents).toHaveBeenCalledWith({ deviceId: 'device-us-1' });
    expect(result.current.device?.friendlyName).toBe('US Node 1');
  });

  it('reports the version the device found', async () => {
    mockDevices([linuxDevice]);
    vi.spyOn(deviceService, 'scanAgents').mockResolvedValue({
      agents: { 'claude-code': { available: true, version: '2.1.0' } },
    });

    const { result } = renderStatus();

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'available', version: '2.1.0' }),
    );
  });

  it('does not scan an offline device', () => {
    mockDevices([{ ...linuxDevice, online: false }]);
    const scanAgents = vi.spyOn(deviceService, 'scanAgents');

    const { result } = renderStatus();

    expect(result.current.state).toEqual({ status: 'offline' });
    expect(scanAgents).not.toHaveBeenCalled();
  });

  it('re-checks presence instead of scanning when redetecting an offline device', () => {
    mockDevices([{ ...linuxDevice, online: false }]);
    const scanAgents = vi.spyOn(deviceService, 'scanAgents');

    const { result } = renderStatus();
    act(() => result.current.redetect());

    expect(refreshDevices).toHaveBeenCalledTimes(1);
    expect(scanAgents).not.toHaveBeenCalled();
  });

  it('re-scans an online device on redetect', async () => {
    mockDevices([linuxDevice]);
    const scanAgents = vi
      .spyOn(deviceService, 'scanAgents')
      .mockResolvedValueOnce({ agents: { 'claude-code': { available: false } } })
      .mockResolvedValueOnce({ agents: { 'claude-code': { available: true } } });

    const { result } = renderStatus();
    await waitFor(() => expect(result.current.state).toEqual({ status: 'unavailable' }));

    act(() => result.current.redetect());

    await waitFor(() => expect(result.current.state).toEqual({ status: 'available' }));
    expect(scanAgents).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed scan apart from a missing CLI', async () => {
    mockDevices([linuxDevice]);
    vi.spyOn(deviceService, 'scanAgents').mockResolvedValue({
      agents: {},
      error: 'Device tool call failed',
    });

    const { result } = renderStatus();

    await waitFor(() =>
      expect(result.current.state).toEqual({
        reason: 'Device tool call failed',
        status: 'scanFailed',
      }),
    );
  });
});
