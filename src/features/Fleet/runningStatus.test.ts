import { describe, expect, it } from 'vitest';

import { getFleetSidebarStatus } from './runningStatus';

describe('getFleetSidebarStatus', () => {
  it('masks running topic status after visible output ended but runtime is still bookkeeping', () => {
    expect(
      getFleetSidebarStatus({
        isRuntimeRunning: true,
        status: 'running',
        visibleStartedAt: undefined,
      }),
    ).toBe('completed');
  });

  it('keeps running topic status when no local runtime operation is loaded', () => {
    expect(
      getFleetSidebarStatus({
        isRuntimeRunning: false,
        status: 'running',
        visibleStartedAt: undefined,
      }),
    ).toBe('running');
  });

  it('keeps running topic status while visible runtime elapsed time is available', () => {
    expect(
      getFleetSidebarStatus({
        isRuntimeRunning: true,
        status: 'running',
        visibleStartedAt: 1000,
      }),
    ).toBe('running');
  });
});
