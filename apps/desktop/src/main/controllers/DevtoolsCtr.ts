import type { AppProcessMetrics, GpuStatus } from '@lobechat/electron-client-ipc';
import { app } from 'electron';

import { ControllerModule, IpcMethod } from './index';

interface CompleteGpuInfo {
  auxAttributes?: Record<string, unknown>;
  machineModelName?: string;
  machineModelVersion?: string;
}

const readText = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

export default class DevtoolsCtr extends ControllerModule {
  static override readonly groupName = 'devtools';

  @IpcMethod()
  async openDevtools() {
    const devtoolsBrowser = this.app.browserManager.retrieveByIdentifier('devtools');
    devtoolsBrowser.show();
  }

  // percentCPUUsage is measured since the previous getAppMetrics call, so all
  // readings must come from one call — split this per metric and each caller only
  // sees the sliver since the other one sampled.
  @IpcMethod()
  async getAppProcessMetrics(): Promise<AppProcessMetrics> {
    const metrics = app.getAppMetrics();
    const gpuProcesses = metrics.filter((metric) => metric.type === 'GPU');

    return {
      cpuPercent: metrics.reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0),
      gpu:
        gpuProcesses.length === 0
          ? null
          : {
              cpuPercent: gpuProcesses.reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0),
              memoryMB:
                gpuProcesses.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) / 1024,
            },
    };
  }

  @IpcMethod()
  async getGpuStatus(): Promise<GpuStatus> {
    const info = (await app.getGPUInfo('complete')) as CompleteGpuInfo;
    const aux = info?.auxAttributes ?? {};

    return {
      displayType: readText(aux.displayType),
      // Electron's GPUFeatureStatus type is stale — it still declares the removed
      // flash_* keys and misses webgpu / skia_graphite, so trust the runtime record.
      featureStatus: app.getGPUFeatureStatus() as unknown as Record<string, string>,
      machineModel: readText(
        [info?.machineModelName, info?.machineModelVersion].filter(Boolean).join(' '),
      ),
      renderer: readText(aux.glRenderer),
      skiaBackend: readText(aux.skiaBackendType),
      vendor: readText(aux.glVendor),
      version: readText(aux.glVersion),
    };
  }
}
