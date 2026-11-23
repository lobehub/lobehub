import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceService } from '@/services/device';

import { useDeviceRunningSummary } from './RunningUsers';

vi.mock('@/services/device', () => ({
  deviceService: { getRunningSummary: vi.fn(async () => []) },
}));

const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const calls = () => vi.mocked(deviceService.getRunningSummary).mock.calls.length;

describe('useDeviceRunningSummary', () => {
  let wrapper: (props: PropsWithChildren) => ReturnType<typeof createElement>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    const cache = new Map();
    wrapper = ({ children }: PropsWithChildren) =>
      createElement(SWRConfig, {
        children,
        value: { isOnline: () => true, isVisible: () => true, provider: () => cache },
      });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Regression: each device card polled on its own timer, so N cards made N requests every 15s.
  it('serves every mounted card from one poll', async () => {
    for (let card = 0; card < 3; card++) {
      renderHook(() => useDeviceRunningSummary(), { wrapper });
      await tick(2000);
    }
    const before = calls();
    await tick(60_000);
    expect(calls() - before).toBeLessThanOrEqual(5);
  });
});
