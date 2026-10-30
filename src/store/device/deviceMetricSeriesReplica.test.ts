/**
 * @vitest-environment happy-dom
 *
 * A device's health series is a replica: every reader (card, hover panel,
 * composer chip, detail page) shares one entry per device + scope, and a
 * revisit charts the persisted copy before the server answers.
 */
import { randomUUID } from 'node:crypto';

import type { DeviceMetricSeries } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { deviceService } from '@/services/device';

import { initialState } from './initialState';
import { type DeviceMetricSeriesParams, deviceMetricSeriesResource } from './projection';
import { deviceSelectors } from './selectors';
import { useDeviceStore } from './store';

vi.mock('@/services/device', () => ({
  deviceService: { getMetricSeries: vi.fn() },
}));

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

const series = (cpuPercent: number): DeviceMetricSeries => ({
  bucketMs: 300_000,
  cpuCount: 8,
  from: 0,
  memoryTotalBytes: 100,
  points: [
    {
      connected: true,
      cpuPercent,
      load1: 1,
      memoryPercent: 30,
      memoryUsedBytes: 30,
      observedAt: 1,
    },
  ],
  to: 2,
});

const WORKSPACE: DeviceMetricSeriesParams = { deviceId: 'dev-1', scope: 'workspace' };
const PERSONAL: DeviceMetricSeriesParams = { deviceId: 'dev-1', scope: 'personal' };

const read = (params: DeviceMetricSeriesParams) =>
  deviceSelectors.getMetricSeries(params)(useDeviceStore.getState());

describe('device metric series replica', () => {
  let scope = '';

  beforeEach(() => {
    scope = `metric-user-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => useDeviceStore.setState(initialState));
  });

  afterEach(async () => {
    await Promise.all(
      [WORKSPACE, PERSONAL].map((params) =>
        deviceMetricSeriesResource.storage!.remove({
          queryKey: deviceMetricSeriesResource.storageKey(params),
          scope,
        }),
      ),
    );
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('keeps one entry per device and scope', async () => {
    vi.mocked(deviceService.getMetricSeries).mockImplementation(async (_id, s) =>
      series(s === 'workspace' ? 40 : 10),
    );

    renderHook(
      () => {
        useDeviceStore((s) => s.useFetchDeviceMetricSeries)(WORKSPACE);
        useDeviceStore((s) => s.useFetchDeviceMetricSeries)(PERSONAL);
      },
      { wrapper },
    );

    await waitFor(() => expect(read(WORKSPACE)?.points[0].cpuPercent).toBe(40));
    await waitFor(() => expect(read(PERSONAL)?.points[0].cpuPercent).toBe(10));
    expect(deviceService.getMetricSeries).toHaveBeenCalledWith('dev-1', 'workspace');
  });

  it('charts the persisted series before the network answers', async () => {
    await deviceMetricSeriesResource.storage!.set(
      { queryKey: deviceMetricSeriesResource.storageKey(WORKSPACE), scope },
      { data: series(55), updatedAt: 1 },
    );
    vi.mocked(deviceService.getMetricSeries).mockImplementation(() => new Promise(() => {}));

    renderHook(() => useDeviceStore((s) => s.useFetchDeviceMetricSeries)(WORKSPACE), { wrapper });

    await waitFor(() => expect(read(WORKSPACE)?.points[0].cpuPercent).toBe(55));
  });

  it('does not fetch while disabled', async () => {
    renderHook(() => useDeviceStore((s) => s.useFetchDeviceMetricSeries)(WORKSPACE, false), {
      wrapper,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(deviceService.getMetricSeries).not.toHaveBeenCalled();
  });
});
