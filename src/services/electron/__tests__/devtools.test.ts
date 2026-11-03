import { describe, expect, it, vi } from 'vitest';

import { electronDevtoolsService } from '../devtools';

const getAppProcessMetricsMock = vi.fn();
const getGpuStatusMock = vi.fn();
const openDevtoolsMock = vi.fn();
vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: vi.fn(() => ({
    devtools: {
      getAppProcessMetrics: getAppProcessMetricsMock,
      getGpuStatus: getGpuStatusMock,
      openDevtools: openDevtoolsMock,
    },
  })),
}));
const { ensureElectronIpc } = await import('@/utils/electron/ipc');

describe('DevtoolsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('openDevtools', () => {
    it('should call dispatch with openDevtools', async () => {
      await electronDevtoolsService.openDevtools();
      expect(ensureElectronIpc).toHaveBeenCalled();
      expect(openDevtoolsMock).toHaveBeenCalled();
    });

    it('should return void when dispatch succeeds', async () => {
      openDevtoolsMock.mockResolvedValueOnce(undefined);
      const result = await electronDevtoolsService.openDevtools();
      expect(result).toBeUndefined();
    });

    it('should throw error when dispatch fails', async () => {
      const error = new Error('Failed to open devtools');
      openDevtoolsMock.mockRejectedValueOnce(error);

      await expect(electronDevtoolsService.openDevtools()).rejects.toThrow(error);
    });
  });

  describe('getAppProcessMetrics', () => {
    it('should return the process metrics reported over ipc', async () => {
      const metrics = { cpuPercent: 12.5, gpu: { cpuPercent: 2, memoryMB: 64 } };
      getAppProcessMetricsMock.mockResolvedValueOnce(metrics);

      await expect(electronDevtoolsService.getAppProcessMetrics()).resolves.toEqual(metrics);
      expect(getAppProcessMetricsMock).toHaveBeenCalled();
    });
  });

  describe('getGpuStatus', () => {
    it('should return the gpu status reported over ipc', async () => {
      const status = { featureStatus: { webgl: 'enabled_on' }, renderer: 'ANGLE' };
      getGpuStatusMock.mockResolvedValueOnce(status);

      await expect(electronDevtoolsService.getGpuStatus()).resolves.toEqual(status);
      expect(getGpuStatusMock).toHaveBeenCalled();
    });
  });
});
