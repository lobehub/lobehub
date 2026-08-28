export interface GpuProcessMetrics {
  cpuPercent: number;
  memoryMB: number;
}

export interface AppProcessMetrics {
  cpuPercent: number;
  gpu: GpuProcessMetrics | null;
}

export interface GpuStatus {
  displayType: string | null;
  featureStatus: Record<string, string>;
  machineModel: string | null;
  renderer: string | null;
  skiaBackend: string | null;
  vendor: string | null;
  version: string | null;
}
