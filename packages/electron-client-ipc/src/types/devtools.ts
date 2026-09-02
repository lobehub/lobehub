export interface GpuProcessMetrics {
  cpuPercent: number;
  memoryMB: number;
}

export interface AppProcessMetrics {
  cpuPercent: number;
  gpu: GpuProcessMetrics | null;
  /** Resident set of the calling renderer, null when its pid is not in the metrics. */
  rendererResidentMB: number | null;
}

export interface RendererMemoryInfo {
  privateBytes: number;
  sharedBytes: number;
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
