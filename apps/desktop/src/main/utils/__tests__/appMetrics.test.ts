import { describe, expect, it, vi } from 'vitest';

const getAppMetrics = vi.fn(() => []);
vi.mock('electron', () => ({ app: { getAppMetrics } }));

const { getSharedAppMetrics } = await import('../appMetrics');

describe('getSharedAppMetrics', () => {
  it('reuses one sample for 1.5 s so cpu windows are not cut short', () => {
    getSharedAppMetrics(10_000);
    getSharedAppMetrics(11_499);
    expect(getAppMetrics).toHaveBeenCalledTimes(1);
    getSharedAppMetrics(11_500);
    expect(getAppMetrics).toHaveBeenCalledTimes(2);
  });
});
