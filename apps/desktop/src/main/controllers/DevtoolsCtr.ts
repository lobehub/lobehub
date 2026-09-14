import type { AppProcessMetrics, GpuStatus, MemoryDump } from '@lobechat/electron-client-ipc';
import { app } from 'electron';

import { collectRendererGarbage, startIdleRendererGc } from '@/utils/idleRendererGc';
import { getIpcContext } from '@/utils/ipc';
import { parseMemoryDump, type TraceEvent } from '@/utils/memoryDump';

import { ControllerModule, IpcMethod } from './index';

interface CompleteGpuInfo {
  auxAttributes?: Record<string, unknown>;
  machineModelName?: string;
  machineModelVersion?: string;
}

const readText = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const MEMORY_DUMP_TIMEOUT = 15_000;

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
    const rendererPid = getIpcContext()?.sender.getOSProcessId();
    const renderer =
      rendererPid === undefined ? undefined : metrics.find((metric) => metric.pid === rendererPid);

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
      processes: metrics.map((metric) => ({
        cpuPercent: metric.cpu.percentCPUUsage,
        name: readText(metric.name) ?? readText(metric.serviceName),
        pid: metric.pid,
        type: metric.type,
        workingSetMB: metric.memory.workingSetSize / 1024,
      })),
      rendererResidentMB: renderer ? renderer.memory.workingSetSize / 1024 : null,
    };
  }

  private rendererSender(what: string) {
    const contents = getIpcContext()?.sender;
    if (!contents) throw new Error(`${what} needs a renderer sender`);
    return contents;
  }

  @IpcMethod()
  async collectRendererGarbage(): Promise<void> {
    await collectRendererGarbage(this.rendererSender('garbage collection'));
  }

  afterFirstFrame() {
    startIdleRendererGc();
  }

  @IpcMethod()
  async captureMemoryDump(): Promise<MemoryDump> {
    const contents = this.rendererSender('memory dump');
    const dbg = contents.debugger;
    const attachedHere = !dbg.isAttached();
    if (attachedHere) dbg.attach('1.3');

    const events: TraceEvent[] = [];
    let finish!: () => void;
    const complete = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const onMessage = (_event: unknown, method: string, params: { value?: TraceEvent[] }) => {
      if (method === 'Tracing.dataCollected') events.push(...(params.value ?? []));
      if (method === 'Tracing.tracingComplete') finish();
    };
    dbg.on('message', onMessage);

    try {
      await dbg.sendCommand('Tracing.start', {
        traceConfig: {
          includedCategories: ['disabled-by-default-memory-infra'],
          memoryDumpConfig: { triggers: [] },
        },
        transferMode: 'ReportEvents',
      });
      await dbg.sendCommand('Tracing.requestMemoryDump', { levelOfDetail: 'detailed' });
      await dbg.sendCommand('Tracing.end');
      await Promise.race([
        complete,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('memory dump timed out')), MEMORY_DUMP_TIMEOUT);
        }),
      ]);
    } finally {
      dbg.off('message', onMessage);
      if (attachedHere) dbg.detach();
    }

    return parseMemoryDump(events, contents.getOSProcessId());
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
