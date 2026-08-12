import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import DevtoolsCtr from '../DevtoolsCtr';

const { getAppMetricsMock, ipcMainHandleMock } = vi.hoisted(() => ({
  getAppMetricsMock: vi.fn(),
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getAppMetrics: getAppMetricsMock,
  },
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

// Mock App and its dependencies
const mockShow = vi.fn();
const mockRetrieveByIdentifier = vi.fn(() => ({
  show: mockShow,
}));

// Create an object that sufficiently mocks App behavior to satisfy DevtoolsCtr's needs
const mockApp = {
  browserManager: {
    retrieveByIdentifier: mockRetrieveByIdentifier,
  },
  // If DevtoolsCtr or its base class uses other app properties/methods during construction or method calls,
  // they also need to be added as mocks here
} as unknown as App; // Type assertion since we only mock a subset of the App structure

describe('DevtoolsCtr', () => {
  let devtoolsCtr: DevtoolsCtr;

  beforeEach(() => {
    vi.clearAllMocks(); // Only clears mock function records created by vi.fn(), does not affect IoCContainer state
    ipcMainHandleMock.mockClear();

    // Instantiate DevtoolsCtr. Its @IpcMethod decorator will execute and interact with the real IoCContainer.
    devtoolsCtr = new DevtoolsCtr(mockApp);
  });

  describe('openDevtools', () => {
    it('should retrieve the devtools browser window using app.browserManager and show it', async () => {
      await devtoolsCtr.openDevtools();

      // Verify that browserManager.retrieveByIdentifier is called with the 'devtools' argument
      expect(mockRetrieveByIdentifier).toHaveBeenCalledWith('devtools');
      // Verify that the show method of the returned object is called
      expect(mockShow).toHaveBeenCalled();
    });
  });

  describe('getAppCpuUsage', () => {
    it('should sum percentCPUUsage across all app processes', async () => {
      getAppMetricsMock.mockReturnValue([
        { cpu: { percentCPUUsage: 1.5 } },
        { cpu: { percentCPUUsage: 2.25 } },
        { cpu: { percentCPUUsage: 0 } },
      ]);

      await expect(devtoolsCtr.getAppCpuUsage()).resolves.toEqual({ percent: 3.75 });
    });

    it('should return zero when there are no process metrics', async () => {
      getAppMetricsMock.mockReturnValue([]);

      await expect(devtoolsCtr.getAppCpuUsage()).resolves.toEqual({ percent: 0 });
    });
  });
});
