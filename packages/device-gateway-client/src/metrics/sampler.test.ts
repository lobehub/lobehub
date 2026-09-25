import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { DeviceMetricSample } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { DeviceMetricsSampler } from './sampler';

const setup = async (
  overrides: {
    connected?: () => boolean;
    upload?: (s: DeviceMetricSample[]) => Promise<void>;
  } = {},
) => {
  let now = 1_000_000;
  let idle = 0;
  let total = 0;
  const storagePath = path.join(
    await mkdtemp(path.join(os.tmpdir(), 'lh-metrics-')),
    'backlog.json',
  );
  const upload = vi.fn(overrides.upload ?? (async () => {}));
  const create = () =>
    new DeviceMetricsSampler({
      isConnected: overrides.connected ?? (() => true),
      now: () => now,
      readers: {
        // Each reading adds 100 units of CPU time, 25 of them busy.
        cpuTimes: () => ({ idle: (idle += 75), total: (total += 100) }),
        loadAverage: () => [1, 2, 3],
        memory: async () => ({ totalBytes: 100, usedBytes: 40 }),
      },
      storagePath,
      upload,
    });
  return { advance: (ms: number) => (now += ms), create, storagePath, upload };
};

describe('DeviceMetricsSampler', () => {
  it('records CPU, memory, load and connection state', async () => {
    const { create, upload } = await setup({ connected: () => false });
    const sampler = create();
    await sampler.start();
    await sampler.sample();
    await sampler.flush();
    await sampler.stop();

    expect(upload).toHaveBeenCalledWith([
      expect.objectContaining({
        connected: false,
        cpuPercent: 25,
        load1: 1,
        load15: 3,
        load5: 2,
        memoryTotalBytes: 100,
        memoryUsedBytes: 40,
        observedAt: 1_000_000,
      }),
    ]);
  });

  it('keeps samples until an upload succeeds, across a restart', async () => {
    let online = false;
    const { advance, create, storagePath, upload } = await setup({
      upload: async () => {
        if (!online) throw new Error('offline');
      },
    });

    const first = create();
    await first.start();
    await first.sample();
    advance(60_000);
    await first.sample();
    await first.flush();
    await first.stop();
    expect(JSON.parse(await readFile(storagePath, 'utf8'))).toHaveLength(2);

    online = true;
    const second = create();
    await second.start();
    await second.flush();
    await second.stop();

    expect(upload).toHaveBeenLastCalledWith([
      expect.objectContaining({ observedAt: 1_000_000 }),
      expect.objectContaining({ observedAt: 1_060_000 }),
    ]);
    expect(second.pendingCount).toBe(0);
    expect(JSON.parse(await readFile(storagePath, 'utf8'))).toEqual([]);
  });

  it('drops backlog older than the retention window', async () => {
    const { advance, create, upload } = await setup({
      upload: async () => {
        throw new Error('offline');
      },
    });
    const sampler = create();
    await sampler.start();
    await sampler.sample();
    advance(4 * 24 * 60 * 60 * 1000);
    await sampler.sample();
    await sampler.stop();

    expect(sampler.pendingCount).toBe(1);
    expect(upload).not.toHaveBeenCalled();
  });

  it('pushes pending samples on a clean stop', async () => {
    const { create, upload } = await setup();
    const sampler = create();
    await sampler.start();
    await sampler.sample();
    await sampler.stop({ flushTimeoutMs: 3000 });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(sampler.pendingCount).toBe(0);
  });

  it('does not hang a clean stop on an upload that never answers', async () => {
    vi.useFakeTimers();
    try {
      const { create } = await setup({ upload: () => new Promise(() => {}) });
      const sampler = create();
      await sampler.start();
      await sampler.sample();

      let stopped = false;
      const stopping = sampler.stop({ flushTimeoutMs: 3000 }).then(() => (stopped = true));
      await vi.advanceTimersByTimeAsync(2999);
      expect(stopped).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await stopping;
      // The unsent sample stays in the backlog for the next start.
      expect(sampler.pendingCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
