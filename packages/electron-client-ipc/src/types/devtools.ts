export interface GpuProcessMetrics {
  cpuPercent: number;
  memoryMB: number;
}

export interface AppProcessRow {
  cpuPercent: number;
  name: string | null;
  pid: number;
  type: string;
  workingSetMB: number;
}

export interface AppProcessMetrics {
  cpuPercent: number;
  gpu: GpuProcessMetrics | null;
  processes: AppProcessRow[];
  /** Resident set of the calling renderer, null when its pid is not in the metrics. */
  rendererResidentMB: number | null;
}

export interface RendererHeapInfo {
  limitBytes: number;
  mallocedBytes: number;
  physicalBytes: number;
  totalBytes: number;
  usedBytes: number;
}

export interface RendererBlinkInfo {
  allocatedBytes: number;
  totalBytes: number;
}

export interface RendererMemoryInfo {
  blink: RendererBlinkInfo;
  heap: RendererHeapInfo;
  privateBytes: number;
  sharedBytes: number;
}

export interface MemoryDumpNode {
  children: MemoryDumpNode[];
  name: string;
  sizeBytes: number;
}

export interface MemoryDumpProcess {
  allocators: MemoryDumpNode[];
  isCaller: boolean;
  name: string;
  objectCounts: Record<string, number>;
  pid: number;
  privateFootprintBytes: number | null;
  residentBytes: number | null;
}

export interface MemoryDump {
  capturedAt: number;
  processes: MemoryDumpProcess[];
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
