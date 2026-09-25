import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import GatewayConnectionService from '../gatewayConnectionSrv';

const samplers = vi.hoisted(() => [] as any[]);

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => `/mock/path/${name}`),
    getVersion: vi.fn(() => '0.0.0-test'),
  },
  powerSaveBlocker: { isStarted: vi.fn(() => false), start: vi.fn(() => 1), stop: vi.fn() },
}));

vi.mock('@lobechat/device-gateway-client', () => ({
  DeviceMetricsSampler: vi.fn().mockImplementation(function (options: any) {
    const sampler = {
      flush: vi.fn().mockResolvedValue(undefined),
      options,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    samplers.push(sampler);
    return sampler;
  }),
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

describe('GatewayConnectionService device metrics', () => {
  let service: GatewayConnectionService;

  beforeEach(() => {
    samplers.length = 0;
    service = new GatewayConnectionService({
      browserManager: { broadcastToAllWindows: vi.fn() },
    } as unknown as App);
  });

  it('samples into a per-device backlog under userData and pushes over the live client', async () => {
    await (service as any).startMetricsSampler('dev-1');

    const [sampler] = samplers;
    expect(sampler.start).toHaveBeenCalled();
    expect(sampler.options.storagePath).toBe('/mock/path/userData/device-metrics/dev-1.json');

    const samples = [{ observedAt: 1 }];
    await expect(sampler.options.upload(samples)).rejects.toThrow('not connected');

    // Reconnects swap the client instance; upload must follow the current one.
    const reportMetrics = vi.fn().mockResolvedValue(undefined);
    (service as any).client = { disconnect: vi.fn(), reportMetrics };
    await sampler.options.upload(samples);
    expect(reportMetrics).toHaveBeenCalledWith(samples);
  });

  it('keeps one sampler across reconnects and flushes the backlog when connected', async () => {
    await (service as any).startMetricsSampler('dev-1');
    await (service as any).startMetricsSampler('dev-1');
    expect(samplers).toHaveLength(1);

    const [sampler] = samplers;
    expect(sampler.options.isConnected()).toBe(false);
    (service as any).setStatus('connected');
    expect(sampler.options.isConnected()).toBe(true);
    expect(sampler.flush).toHaveBeenCalled();
  });

  it('stops sampling on an explicit disconnect', async () => {
    await (service as any).startMetricsSampler('dev-1');
    await service.disconnect();

    expect(samplers[0].stop).toHaveBeenCalledWith({ flushTimeoutMs: 3000 });
  });
});
