// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { authedProcedure } = await import('@/libs/trpc/lambda');
  return { wsCompatProcedure: authedProcedure };
});

const deviceModel = { findByDeviceId: vi.fn(), findWorkspaceDeviceById: vi.fn() };
vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn(function () {
    return deviceModel;
  }),
}));

const queryDeviceMetrics = vi.fn();
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { queryDeviceMetrics },
}));

const { deviceMetricRouter } = await import('../deviceMetric');

const sample = (observedAt: number) => ({
  connected: true,
  cpuCount: 8,
  cpuPercent: 12,
  load1: 1,
  load15: 1,
  load5: 1,
  memoryTotalBytes: 100,
  memoryUsedBytes: 50,
  observedAt,
});

describe('deviceMetricRouter.getSeries', () => {
  const personal = deviceMetricRouter.createCaller({ serverDB: {}, userId: 'user-1' } as any);
  const workspace = deviceMetricRouter.createCaller({
    serverDB: {},
    userId: 'user-1',
    workspaceId: 'ws-1',
  } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    queryDeviceMetrics.mockResolvedValue([]);
  });

  it('reads the gateway for a visible personal device and buckets 12 hours into 5-minute points', async () => {
    deviceModel.findByDeviceId.mockResolvedValue({ id: 'row-1', workspaceId: null });
    const now = Date.now();
    queryDeviceMetrics.mockResolvedValue([sample(now - 60_000)]);

    const series = await personal.getSeries({ deviceId: 'dev-1' });

    expect(queryDeviceMetrics).toHaveBeenCalledWith({
      deviceId: 'dev-1',
      since: series.from,
      userId: 'user-1',
      workspaceId: undefined,
    });
    expect(series.bucketMs).toBe(5 * 60_000);
    expect(series.to - series.from).toBe(12 * 60 * 60 * 1000);
    expect(series.cpuCount).toBe(8);
    expect(series.points).toHaveLength(1);
  });

  it('does not treat a workspace row as personal', async () => {
    deviceModel.findByDeviceId.mockResolvedValue({ id: 'row-ws', workspaceId: 'ws-1' });

    await expect(personal.getSeries({ deviceId: 'dev-ws' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(queryDeviceMetrics).not.toHaveBeenCalled();
  });

  it('hides workspace devices the caller cannot see', async () => {
    deviceModel.findWorkspaceDeviceById.mockResolvedValue(undefined);

    await expect(workspace.getSeries({ deviceId: 'private' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(queryDeviceMetrics).not.toHaveBeenCalled();
  });

  it('routes a visible workspace device to the workspace principal', async () => {
    deviceModel.findWorkspaceDeviceById.mockResolvedValue({ id: 'row-ws', workspaceId: 'ws-1' });

    const series = await workspace.getSeries({ deviceId: 'dev-ws' });

    expect(queryDeviceMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'dev-ws', workspaceId: 'ws-1' }),
    );
    expect(series.cpuCount).toBeNull();
    expect(series.points).toEqual([]);
  });
});
