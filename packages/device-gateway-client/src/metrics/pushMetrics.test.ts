import { describe, expect, it, vi } from 'vitest';

import { pushMetrics } from './pushMetrics';

const target = (connectionStatus = 'connected', fails = false) => ({
  connectionStatus,
  reportMetrics: vi.fn(() => (fails ? Promise.reject(new Error('down')) : Promise.resolve())),
});

describe('pushMetrics', () => {
  const samples = [{ observedAt: 1 }] as any;

  it('mirrors the batch to connected workspace-share connections', async () => {
    const primary = target();
    const shared = target();
    const offline = target('reconnecting');

    await pushMetrics(primary, [shared, offline], samples);

    expect(primary.reportMetrics).toHaveBeenCalledWith(samples);
    expect(shared.reportMetrics).toHaveBeenCalledWith(samples);
    expect(offline.reportMetrics).not.toHaveBeenCalled();
  });

  it('fails when the device connection fails, so the batch is kept', async () => {
    const shared = target();

    await expect(pushMetrics(target('connected', true), [shared], samples)).rejects.toThrow('down');
    expect(shared.reportMetrics).not.toHaveBeenCalled();
  });

  it('does not fail on a mirror error', async () => {
    await expect(
      pushMetrics(target(), [target('connected', true)], samples),
    ).resolves.toBeUndefined();
  });
});
