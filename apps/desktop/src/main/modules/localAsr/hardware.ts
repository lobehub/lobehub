import type {
  LocalAsrHardwareInfo,
  LocalAsrHardwareReason,
  LocalAsrHardwareTier,
} from '@lobechat/electron-client-ipc';

const GB = 1024 ** 3;

/** Peak RSS of the standard pack is ~1 GB (T-810 benchmark); 8 GB leaves headroom for the app. */
export const MIN_MEMORY_BYTES = 8 * GB;

/** Keep this much free on top of the model files themselves. */
const DISK_HEADROOM_BYTES = 512 * 1024 ** 2;

/** Platforms sherpa-onnx-node publishes a prebuilt runtime for. */
const RUNTIME_PLATFORMS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-x64',
]);

export const isRuntimePlatform = (platform: string, arch: string) =>
  RUNTIME_PLATFORMS.has(`${platform}-${arch}`);

export interface HardwareProbe {
  arch: string;
  cpuCores: number;
  cpuModel: string;
  freeDiskBytes?: number;
  platform: string;
  requiredDiskBytes: number;
  runtimeAvailable: boolean;
  totalMemoryBytes: number;
}

const downgrade = (tier: LocalAsrHardwareTier): LocalAsrHardwareTier =>
  tier === 'recommended' || tier === 'supported' ? 'limited' : tier;

/**
 * Classify this machine for local transcription. Only Apple Silicon has measured
 * numbers (M4 Pro: realtime RTF 0.013, refine + diarization RTF 0.074), so every
 * other runtime platform is "supported" but flagged as untested.
 */
export const assessHardware = (probe: HardwareProbe): LocalAsrHardwareInfo => {
  const reasons: LocalAsrHardwareReason[] = [];
  let tier: LocalAsrHardwareTier;

  if (!isRuntimePlatform(probe.platform, probe.arch)) {
    tier = 'unsupported';
    reasons.push('unsupported_platform');
  } else if (!probe.runtimeAvailable) {
    tier = 'unsupported';
    reasons.push('native_runtime_missing');
  } else if (probe.platform === 'darwin' && probe.arch === 'arm64') {
    tier = 'recommended';
    reasons.push('apple_silicon');
  } else {
    tier = 'supported';
    reasons.push('untested_platform');
  }

  if (tier !== 'unsupported' && probe.totalMemoryBytes < MIN_MEMORY_BYTES) {
    tier = downgrade(tier);
    reasons.push('low_memory');
  }

  if (
    tier !== 'unsupported' &&
    probe.freeDiskBytes !== undefined &&
    probe.freeDiskBytes < probe.requiredDiskBytes + DISK_HEADROOM_BYTES
  ) {
    tier = downgrade(tier);
    reasons.push('low_disk');
  }

  return { ...probe, reasons, tier };
};
