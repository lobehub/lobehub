import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SegmentSink } from '../segmentSink';
import type { LiveSegment } from '../types';

const segment = (seq: number): LiveSegment => ({
  endMs: (seq + 1) * 1000,
  seq,
  startMs: seq * 1000,
  text: `s${seq}`,
});

describe('SegmentSink', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a failed save with the same segments and keeps their order', async () => {
    const stored = new Map<number, string>();
    const save = vi
      .fn<(segments: LiveSegment[]) => Promise<void>>()
      .mockImplementationOnce(async () => {
        throw new Error('offline');
      })
      .mockImplementation(async (segments) => {
        for (const item of segments) stored.set(item.seq, item.text);
      });
    const sink = new SegmentSink({ save });

    sink.push([segment(0), segment(1)]);
    await vi.advanceTimersByTimeAsync(0);
    sink.push([segment(2)]);
    const flushed = sink.flush(5000);
    await vi.advanceTimersByTimeAsync(5000);

    expect(await flushed).toBe(true);
    expect(save.mock.calls[0][0].map((s) => s.seq)).toEqual([0, 1]);
    expect(save.mock.calls[1][0].map((s) => s.seq)).toEqual([0, 1, 2]);
    expect([...stored.entries()]).toEqual([
      [0, 's0'],
      [1, 's1'],
      [2, 's2'],
    ]);
    expect(sink.pendingCount).toBe(0);
  });

  it('reports a flush that cannot complete in time', async () => {
    const sink = new SegmentSink({
      save: async () => {
        throw new Error('offline');
      },
    });
    sink.push([segment(0)]);
    const flushed = sink.flush(500);
    await vi.advanceTimersByTimeAsync(500);

    expect(await flushed).toBe(false);
    expect(sink.pendingCount).toBe(1);
  });
});
