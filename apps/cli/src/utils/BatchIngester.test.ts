import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BatchIngester, type IngestSink } from './BatchIngester';

const makeEvent = (n: number): AgentStreamEvent =>
  ({
    data: { n },
    operationId: 'op-1',
    stepIndex: n,
    timestamp: 1_700_000_000_000 + n,
    type: 'tool_start',
  }) as AgentStreamEvent;

const numbers = (events: AgentStreamEvent[]) => events.map((event) => (event.data as any).n);

describe('BatchIngester', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces events that arrive during a slow in-flight request into one follow-up batch', async () => {
    // Regression: the batch used to be spliced when a flush was SCHEDULED, so
    // events arriving while a slow request was in flight fragmented into
    // per-250ms micro-batches queued serially — throughput stayed ~one tiny
    // batch per RTT and the backlog never caught up. Splicing at send time
    // must ship everything that accumulated behind the slow request as a
    // single batch.
    const batches: number[][] = [];
    let releaseFirst!: () => void;
    const firstAck = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sink: IngestSink = {
      finish: vi.fn(async () => {}),
      ingest: vi.fn(async (events) => {
        batches.push(numbers(events));
        if (batches.length === 1) await firstAck; // slow first round-trip
      }),
    };
    const ingester = new BatchIngester(sink);

    ingester.push(makeEvent(1));
    await vi.advanceTimersByTimeAsync(250); // flush timer → [1] starts sending, blocked

    ingester.push(makeEvent(2));
    await vi.advanceTimersByTimeAsync(300);
    ingester.push(makeEvent(3));
    await vi.advanceTimersByTimeAsync(300);

    releaseFirst();
    await ingester.drain();

    expect(batches).toEqual([[1], [2, 3]]);
  });

  it('never sends later batches once an earlier batch has exhausted its retries', async () => {
    // Regression: queued follow-up batches used to keep sending after the
    // first batch was permanently lost — if the server recovered mid-window,
    // it received a gapped stream (e.g. a tool_end whose tool_start never
    // arrived). After a fatal error the worker must stop and drop everything
    // still buffered.
    const batches: number[][] = [];
    const sink: IngestSink = {
      finish: vi.fn(async () => {}),
      ingest: vi.fn(async (events) => {
        batches.push(numbers(events));
        throw new Error('server down');
      }),
    };
    const ingester = new BatchIngester(sink);

    // Batch 1 fills to MAX_BATCH and starts sending (then keeps retrying)…
    for (let i = 1; i <= 50; i++) ingester.push(makeEvent(i));
    // …while a second batch's worth of events arrives during the retry window.
    for (let i = 51; i <= 100; i++) ingester.push(makeEvent(i));

    const drained = ingester.drain();
    const assertion = expect(drained).rejects.toThrow('server down');
    // Back-off schedule: 500 + 1000 + 2000 + 4000 + 8000 ms.
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;

    expect(sink.ingest).toHaveBeenCalledTimes(6); // batch 1: initial + 5 retries
    for (const batch of batches) {
      expect(batch[0]).toBe(1); // every call was batch 1 — [51..100] never sent
      expect(batch).toHaveLength(50);
    }
  });

  it('splits a synchronous burst into MAX_BATCH-sized batches in order', async () => {
    const batches: number[][] = [];
    const sink: IngestSink = {
      finish: vi.fn(async () => {}),
      ingest: vi.fn(async (events) => {
        batches.push(numbers(events));
      }),
    };
    const ingester = new BatchIngester(sink);

    const all = Array.from({ length: 120 }, (_, i) => i + 1);
    for (const n of all) ingester.push(makeEvent(n));
    await ingester.drain();

    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 20]);
    expect(batches.flat()).toEqual(all);
  });
});
