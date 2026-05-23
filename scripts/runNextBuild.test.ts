import { describe, expect, it } from 'vitest';

import {
  BUILD_RSS_SAMPLING_INTERVAL_MS,
  createProcessTreeSnapshot,
  TURBOPACK_VERCEL_MAX_OLD_SPACE_SIZE_MB,
  TURBOPACK_VERCEL_PARALLEL,
  TURBOPACK_VERCEL_DEBUG_FLAGS,
  createMemorySnapshot,
  getNextBuildArgs,
  getVercelBuildEnv,
  getVercelNodeOptions,
  LOBE_BUILD_DIAGNOSTICS,
  VERCEL_BUILD_SYSTEM_REPORT,
} from './runNextBuild.mjs';

describe('runNextBuild helpers', () => {
  it('should replace the Vercel max old space size override', () => {
    expect(getVercelNodeOptions('--max-old-space-size=8192 --trace-warnings')).toBe(
      `--max-old-space-size=${TURBOPACK_VERCEL_MAX_OLD_SPACE_SIZE_MB} --trace-warnings`,
    );
  });

  it('should append the Vercel max old space size override when missing', () => {
    expect(getVercelNodeOptions('--trace-warnings')).toBe(
      `--trace-warnings --max-old-space-size=${TURBOPACK_VERCEL_MAX_OLD_SPACE_SIZE_MB}`,
    );
  });

  it('should forward extra next build arguments on Vercel', () => {
    expect(getNextBuildArgs(['--debug-prerender', '--no-lint'], true)).toEqual([
      'build',
      '--turbopack',
      ...TURBOPACK_VERCEL_DEBUG_FLAGS,
      '--debug-prerender',
      '--no-lint',
    ]);
  });

  it('should keep non-Vercel builds on the default next build path', () => {
    expect(getNextBuildArgs(['--debug-prerender'], false)).toEqual(['build', '--debug-prerender']);
  });

  it('should add the Vercel parallelism override', () => {
    expect(getVercelBuildEnv({ VERCEL_ENV: 'production' }).TURBOPACK_PARALLEL).toBe(
      TURBOPACK_VERCEL_PARALLEL,
    );
  });

  it('should enable Vercel build system reports by default', () => {
    expect(getVercelBuildEnv({ VERCEL_ENV: 'production' }).VERCEL_BUILD_SYSTEM_REPORT).toBe(
      VERCEL_BUILD_SYSTEM_REPORT,
    );
  });

  it('should enable build diagnostics by default on Vercel', () => {
    expect(getVercelBuildEnv({ VERCEL_ENV: 'production' }).LOBE_BUILD_DIAGNOSTICS).toBe(
      LOBE_BUILD_DIAGNOSTICS,
    );
  });

  it('should format RSS snapshots without heap max', () => {
    const snapshot = createMemorySnapshot({
      memoryUsage: () => ({
        arrayBuffers: 5 * 1024 * 1024,
        external: 7 * 1024 * 1024,
        heapTotal: 11 * 1024 * 1024,
        heapUsed: 3 * 1024 * 1024,
        rss: 13 * 1024 * 1024,
      }),
    });

    expect(snapshot).toEqual({
      arrayBuffers: '5.00 MiB',
      external: '7.00 MiB',
      heapTotal: '11.00 MiB',
      heapUsed: '3.00 MiB',
      rss: '13.00 MiB',
    });
  });

  it('should expose the RSS sampling interval constant', () => {
    expect(BUILD_RSS_SAMPLING_INTERVAL_MS).toBe(30_000);
  });

  it('should summarize the next build process tree from ps output', () => {
    const snapshot = createProcessTreeSnapshot(
      101,
      [
        '101 1 2048 30.0 00:14:00 node',
        '202 101 1024 12.5 00:05:00 next-server',
        '303 202 512 6.0 00:04:00 rustc',
      ].join('\n'),
    );

    expect(snapshot).toEqual({
      processCount: 3,
      rootPid: 101,
      topProcesses: [
        { command: 'node', etime: '00:14:00', pcpu: 30, pid: 101, rss: '2.00 MiB' },
        { command: 'next-server', etime: '00:05:00', pcpu: 12.5, pid: 202, rss: '1.00 MiB' },
        { command: 'rustc', etime: '00:04:00', pcpu: 6, pid: 303, rss: '0.50 MiB' },
      ],
      totalRss: '3.50 MiB',
    });
  });
});
