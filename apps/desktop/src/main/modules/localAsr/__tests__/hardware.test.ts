import { describe, expect, it } from 'vitest';

import { assessHardware, type HardwareProbe } from '../hardware';

const GB = 1024 ** 3;

const probe = (overrides: Partial<HardwareProbe> = {}): HardwareProbe => ({
  arch: 'arm64',
  cpuCores: 14,
  cpuModel: 'Apple M4 Pro',
  freeDiskBytes: 200 * GB,
  platform: 'darwin',
  requiredDiskBytes: 275_000_000,
  runtimeAvailable: true,
  totalMemoryBytes: 48 * GB,
  ...overrides,
});

describe('assessHardware', () => {
  it('recommends Apple Silicon with enough memory and disk', () => {
    const result = assessHardware(probe());
    expect(result.tier).toBe('recommended');
    expect(result.reasons).toEqual(['apple_silicon']);
  });

  it('marks other runtime platforms as supported but untested', () => {
    const result = assessHardware(probe({ arch: 'x64', platform: 'win32' }));
    expect(result.tier).toBe('supported');
    expect(result.reasons).toEqual(['untested_platform']);
  });

  it('downgrades machines with less than 8 GB of memory', () => {
    const result = assessHardware(probe({ totalMemoryBytes: 4 * GB }));
    expect(result.tier).toBe('limited');
    expect(result.reasons).toContain('low_memory');
  });

  it('downgrades when the model files do not fit on disk', () => {
    const result = assessHardware(probe({ freeDiskBytes: 300_000_000 }));
    expect(result.tier).toBe('limited');
    expect(result.reasons).toContain('low_disk');
  });

  it('rejects platforms without a prebuilt runtime', () => {
    const result = assessHardware(probe({ arch: 'ia32', platform: 'win32' }));
    expect(result.tier).toBe('unsupported');
    expect(result.reasons).toEqual(['unsupported_platform']);
  });

  it('rejects installs missing the native runtime', () => {
    const result = assessHardware(probe({ runtimeAvailable: false }));
    expect(result.tier).toBe('unsupported');
    expect(result.reasons).toEqual(['native_runtime_missing']);
  });
});
