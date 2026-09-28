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
        return { accepted: true };
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

  it('does not send later batches while the head batch remains unacknowledged', async () => {
    // Regression: queued follow-up batches used to keep sending after the
    // first batch was unacknowledged — if the server recovered mid-window,
    // it received a gapped stream (e.g. a tool_end whose tool_start never
    // arrived). Exhausted retries stop this pump without skipping its head.
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
        return { accepted: true };
      }),
    };
    const ingester = new BatchIngester(sink);

    const all = Array.from({ length: 120 }, (_, i) => i + 1);
    for (const n of all) ingester.push(makeEvent(n));
    await ingester.drain();

    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 20]);
    expect(batches.flat()).toEqual(all);
  });
  it('allows a later drain to retry the retained head without a new event', async () => {
    const ingest = vi.fn<IngestSink['ingest']>().mockRejectedValue(new Error('offline'));
    const ingester = new BatchIngester({ ingest, finish: vi.fn() });
    ingester.push(makeEvent(1));
    const failedDrain = expect(ingester.drain()).rejects.toThrow('offline');
    await vi.advanceTimersByTimeAsync(20_000);
    await failedDrain;
    ingest.mockResolvedValue({ accepted: true });
    await ingester.drain();
    expect(numbers(ingest.mock.calls.at(-1)![0])).toEqual([1]);
    await ingester.drain();
    expect(ingest).toHaveBeenCalledTimes(7);
  });

  it('fails the stream on a refused batch instead of retrying output the server threw away', async () => {
    // Regression: a refusal arrives as a 200 (the operation is over server-side,
    // so the batch is discarded), which the ingester read as "delivered". The
    // agent kept working, every later batch was discarded the same way, and the
    // run finished reporting success on output nobody ever stored.
    const ingest = vi
      .fn<IngestSink['ingest']>()
      .mockResolvedValue({ accepted: false, reason: 'stale-operation' });
    const ingester = new BatchIngester({ finish: vi.fn(), ingest });

    ingester.push(makeEvent(1));
    const drained = expect(ingester.drain()).rejects.toThrow('stale-operation');
    await vi.advanceTimersByTimeAsync(20_000);
    await drained;

    expect(ingest).toHaveBeenCalledTimes(1); // refusal is permanent — no retries
    expect(ingester.failed).toBe(true);

    // And the stream stays failed: later events are dropped rather than queued
    // for an upload that cannot succeed.
    ingester.push(makeEvent(2));
    await expect(ingester.drain()).rejects.toThrow('stale-operation');
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it('reports a lost stream the moment it happens, not only at drain', async () => {
    // The refusal above is terminal, but the caller only learned about it when
    // it drained — i.e. after the agent had finished. A run whose output is
    // already being discarded kept working until then (observed: 15 minutes of
    // a CLI producing output nobody stored). The callback is what lets the
    // caller stop the agent instead.
    const ingest = vi
      .fn<IngestSink['ingest']>()
      .mockResolvedValue({ accepted: false, reason: 'stale-operation' });
    const onFatal = vi.fn();
    const ingester = new BatchIngester({ finish: vi.fn(), ingest }, undefined, onFatal);

    ingester.push(makeEvent(1));
    const drained = expect(ingester.drain()).rejects.toThrow('stale-operation');
    await vi.advanceTimersByTimeAsync(20_000);
    await drained;

    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onFatal.mock.calls[0][0].message).toContain('stale-operation');

    // Latched: a second failure (or a later push on a dead stream) must not
    // re-fire it and abort a run twice.
    ingester.push(makeEvent(2));
    await expect(ingester.drain()).rejects.toThrow('stale-operation');
    expect(onFatal).toHaveBeenCalledTimes(1);
  });

  it('reports an overflow through the same callback', () => {
    const maxBytes = Buffer.byteLength(JSON.stringify(makeEvent(1)));
    const onFatal = vi.fn();
    const ingester = new BatchIngester({ finish: vi.fn(), ingest: vi.fn() }, maxBytes, onFatal);

    ingester.push(makeEvent(1));
    ingester.push(makeEvent(2));

    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0][0].message).toContain('buffer limit exceeded');
  });

  it('treats an ack without a verdict as accepted so older servers keep working', async () => {
    const ingest = vi.fn<IngestSink['ingest']>().mockResolvedValue(undefined as never);
    const ingester = new BatchIngester({ finish: vi.fn(), ingest });

    ingester.push(makeEvent(1));
    await expect(ingester.drain()).resolves.toBeUndefined();
    expect(ingester.failed).toBe(false);
  });

  it('fails closed on overflow instead of dropping a prefix then uploading a gapped stream', async () => {
    const sink: IngestSink = { ingest: vi.fn(), finish: vi.fn() };
    const maxBytes = Buffer.byteLength(JSON.stringify(makeEvent(1)));
    const ingester = new BatchIngester(sink, maxBytes);
    ingester.push(makeEvent(1));
    ingester.push(makeEvent(2));
    expect(ingester.failed).toBe(true);
    ingester.push(makeEvent(3));
    await expect(ingester.drain()).rejects.toThrow('buffer limit exceeded');
    expect(sink.ingest).not.toHaveBeenCalled();
  });
});
