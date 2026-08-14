import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import DevtoolsCtr from '../DevtoolsCtr';

const { getAppMetricsMock, getGPUFeatureStatusMock, getGPUInfoMock, ipcMainHandleMock } =
  vi.hoisted(() => ({
    getAppMetricsMock: vi.fn(),
    getGPUFeatureStatusMock: vi.fn(),
    getGPUInfoMock: vi.fn(),
    ipcMainHandleMock: vi.fn(),
  }));

vi.mock('electron', () => ({
  app: {
    getAppMetrics: getAppMetricsMock,
    getGPUFeatureStatus: getGPUFeatureStatusMock,
    getGPUInfo: getGPUInfoMock,
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

  describe('getAppProcessMetrics', () => {
    it('should sum percentCPUUsage across all app processes', async () => {
      getAppMetricsMock.mockReturnValue([
        { cpu: { percentCPUUsage: 1.5 }, memory: { workingSetSize: 100 }, type: 'Browser' },
        { cpu: { percentCPUUsage: 2.25 }, memory: { workingSetSize: 200 }, type: 'Tab' },
        { cpu: { percentCPUUsage: 0 }, memory: { workingSetSize: 300 }, type: 'Utility' },
      ]);

      await expect(devtoolsCtr.getAppProcessMetrics()).resolves.toEqual({
        cpuPercent: 3.75,
        gpu: null,
      });
    });

    it('should report the gpu process usage separately in megabytes', async () => {
      getAppMetricsMock.mockReturnValue([
        { cpu: { percentCPUUsage: 1.5 }, memory: { workingSetSize: 1024 }, type: 'Browser' },
        { cpu: { percentCPUUsage: 2.5 }, memory: { workingSetSize: 65_536 }, type: 'GPU' },
      ]);

      await expect(devtoolsCtr.getAppProcessMetrics()).resolves.toEqual({
        cpuPercent: 4,
        gpu: { cpuPercent: 2.5, memoryMB: 64 },
      });
    });

    it('should aggregate multiple gpu processes', async () => {
      getAppMetricsMock.mockReturnValue([
        { cpu: { percentCPUUsage: 1 }, memory: { workingSetSize: 1024 }, type: 'GPU' },
        { cpu: { percentCPUUsage: 3 }, memory: { workingSetSize: 3072 }, type: 'GPU' },
      ]);

      await expect(devtoolsCtr.getAppProcessMetrics()).resolves.toEqual({
        cpuPercent: 4,
        gpu: { cpuPercent: 4, memoryMB: 4 },
      });
    });

    it('should return zero when there are no process metrics', async () => {
      getAppMetricsMock.mockReturnValue([]);

      await expect(devtoolsCtr.getAppProcessMetrics()).resolves.toEqual({
        cpuPercent: 0,
        gpu: null,
      });
    });
  });

  describe('getGpuStatus', () => {
    it('should expose the raw feature status record and the gl device attributes', async () => {
      getGPUFeatureStatusMock.mockReturnValue({
        gpu_compositing: 'enabled_on',
        webgpu: 'disabled_off',
      });
      getGPUInfoMock.mockResolvedValue({
        auxAttributes: {
          displayType: 'ANGLE_METAL',
          glRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max)',
          glVendor: 'Google Inc. (Apple)',
          glVersion: 'OpenGL ES 3.0 (ANGLE 2.1)',
          skiaBackendType: 'GraphiteDawnMetal',
        },
        machineModelName: 'Mac',
        machineModelVersion: '16.9',
      });

      await expect(devtoolsCtr.getGpuStatus()).resolves.toEqual({
        displayType: 'ANGLE_METAL',
        featureStatus: { gpu_compositing: 'enabled_on', webgpu: 'disabled_off' },
        machineModel: 'Mac 16.9',
        renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max)',
        skiaBackend: 'GraphiteDawnMetal',
        vendor: 'Google Inc. (Apple)',
        version: 'OpenGL ES 3.0 (ANGLE 2.1)',
      });
      expect(getGPUInfoMock).toHaveBeenCalledWith('complete');
    });

    it('should null out attributes missing from the platform payload', async () => {
      getGPUFeatureStatusMock.mockReturnValue({});
      getGPUInfoMock.mockResolvedValue({});

      await expect(devtoolsCtr.getGpuStatus()).resolves.toEqual({
        displayType: null,
        featureStatus: {},
        machineModel: null,
        renderer: null,
        skiaBackend: null,
        vendor: null,
        version: null,
      });
    });
  });
});
