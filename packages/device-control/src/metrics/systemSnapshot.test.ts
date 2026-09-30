import { describe, expect, it } from 'vitest';

import { cpuPercentBetween, parseMemInfo, parseVmStat } from './systemSnapshot';

describe('cpuPercentBetween', () => {
  it('is the busy share of elapsed CPU time', () => {
    expect(cpuPercentBetween({ idle: 100, total: 200 }, { idle: 175, total: 300 })).toBe(25);
  });

  it('is null when no CPU time elapsed', () => {
    expect(cpuPercentBetween({ idle: 1, total: 2 }, { idle: 1, total: 2 })).toBeNull();
  });
});

describe('parseVmStat', () => {
  const output = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               10000.
Pages active:                             200000.
Pages inactive:                           190000.
Pages speculative:                          5000.
Pages wired down:                         100000.
Pages purgeable:                           20000.
Pages occupied by compressor:              50000.
Anonymous pages:                          150000.
`;

  it('counts app, wired and compressed memory — not file cache', () => {
    expect(parseVmStat(output, 64 * 1024 ** 3)).toBe(
      (150_000 - 20_000 + 100_000 + 50_000) * 16_384,
    );
  });

  it('is undefined for unrecognized output', () => {
    expect(parseVmStat('nope', 1)).toBeUndefined();
  });
});

describe('parseMemInfo', () => {
  it('is total minus available', () => {
    expect(
      parseMemInfo('MemTotal:       1000 kB\nMemFree: 10 kB\nMemAvailable:    250 kB\n'),
    ).toEqual({
      totalBytes: 1000 * 1024,
      usedBytes: 750 * 1024,
    });
  });
});
