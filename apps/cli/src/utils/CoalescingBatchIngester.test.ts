import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IngestSink } from './BatchIngester';
import { CoalescingBatchIngester } from './CoalescingBatchIngester';

const makeEvent = (type: string, data: Record<string, unknown> = {}): AgentStreamEvent =>
  ({ data, operationId: 'op-1', stepIndex: 0, timestamp: 1, type }) as AgentStreamEvent;

const textEvent = (content: string, extra: Record<string, unknown> = {}) =>
  makeEvent('stream_chunk', { chunkType: 'text', content, ...extra });

const reasoningEvent = (reasoning: string, extra: Record<string, unknown> = {}) =>
  makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning, ...extra });

const toolEvent = (i: number) => makeEvent('tool_start', { toolCallId: `tc-${i}` });

const createSink = () => {
  const batches: AgentStreamEvent[][] = [];
  const ingest = vi.fn(async (events: AgentStreamEvent[]) => {
    batches.push([...events]);
  });
  const sink: IngestSink = { finish: vi.fn(async () => {}), ingest };
  return { batches, ingest, sink };
};

describe('CoalescingBatchIngester', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches a tool-heavy run into ≤50-event calls instead of one call per event', async () => {
    // Regression for the serial single-event ingester (#15197 → this change):
    // a 178-command Codex run produced ~700 events, each a separate serial
    // tRPC round-trip — the upload queue kept draining for ~13 minutes AFTER
    // the agent had already finished. Batching must collapse call count by
    // ~MAX_BATCH while preserving completeness and order.
    const { batches, ingest, sink } = createSink();
    const ingester = new CoalescingBatchIngester(sink);

    const events = Array.from({ length: 120 }, (_, i) => toolEvent(i));
    for (const event of events) ingester.push(event);
    await ingester.drain();

    expect(ingest).toHaveBeenCalledTimes(3); // 50 + 50 + 20, NOT 120
    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 20]);
    expect(batches.flat().map((event) => (event.data as any).toolCallId)).toEqual(
      events.map((event) => (event.data as any).toolCallId),
    );
  });

  it('coalesces main-agent text deltas into one replace snapshot ordered before the next event', async () => {
    const { batches, ingest, sink } = createSink();
    const ingester = new CoalescingBatchIngester(sink);

    ingester.push(textEvent('hello '));
    ingester.push(textEvent('world'));
    ingester.push(makeEvent('stream_chunk', { chunkType: 'tools_calling', toolsCalling: [] }));
    await ingester.drain();

    // One batch: [snapshot, tools_calling] — the snapshot must not be
    // overtaken by the event that followed it (the server processes a batch
    // sequentially, so within-batch order IS the wire order).
    expect(ingest).toHaveBeenCalledTimes(1);
    const [batch] = batches;
    expect(batch.map((event) => (event.data as any).chunkType)).toEqual(['text', 'tools_calling']);
    expect(batch[0].data).toMatchObject({
      content: 'hello world',
      snapshotMode: 'replace',
      snapshotSeq: 1,
    });
  });

  it('flushes a pending snapshot on the debounce timer without needing a following event', async () => {
    const { batches, ingest, sink } = createSink();
    const ingester = new CoalescingBatchIngester(sink);

    ingester.push(textEvent('streaming…'));
    await vi.advanceTimersByTimeAsync(200); // snapshot debounce
    await vi.advanceTimersByTimeAsync(250); // batch flush interval

    expect(ingest).toHaveBeenCalledTimes(1);
    expect(batches[0][0].data).toMatchObject({
      content: 'streaming…',
      snapshotMode: 'replace',
      snapshotSeq: 1,
    });
  });

  it('resets the per-message accumulator at stream boundaries (no cross-message duplication)', async () => {
    const { batches, sink } = createSink();
    const ingester = new CoalescingBatchIngester(sink);

    ingester.push(textEvent('first message'));
    ingester.push(makeEvent('stream_end'));
    ingester.push(makeEvent('stream_start', { newStep: true }));
    ingester.push(textEvent('second message'));
    await ingester.drain();

    const batch = batches.flat();
    expect(batch.map((event) => event.type)).toEqual([
      'stream_chunk',
      'stream_end',
      'stream_start',
      'stream_chunk',
    ]);
    // Second snapshot carries ONLY its own message, with a fresh seq.
    expect(batch[0].data).toMatchObject({ content: 'first message', snapshotSeq: 1 });
    expect(batch[3].data).toMatchObject({ content: 'second message', snapshotSeq: 2 });
  });

  it('coalesces reasoning deltas into a replace snapshot ordered before the text snapshot', async () => {
    // Reasoning gets the same snapshot treatment as text: `replace` is
    // idempotent under batch redelivery, whereas raw deltas re-append and
    // durably duplicate the thinking content on a cold-replica retry.
    const { batches, ingest, sink } = createSink();
    const ingester = new CoalescingBatchIngester(sink);

    ingester.push(reasoningEvent('thinking '));
    ingester.push(reasoningEvent('hard'));
    ingester.push(textEvent('the answer'));
    ingester.push(makeEvent('stream_chunk', { chunkType: 'tools_calling', toolsCalling: [] }));
    await ingester.drain();

    expect(ingest).toHaveBeenCalledTimes(1);
    const [batch] = batches;
    // Emission order preserved: reasoning → text → tools.
    expect(batch.map((event) => (event.data as any).chunkType)).toEqual([
      'reasoning',
      'text',
      'tools_calling',
    ]);
    expect(batch[0].data).toMatchObject({
      reasoning: 'thinking hard',
      snapshotMode: 'replace',
      snapshotSeq: 1,
    });
    expect(batch[1].data).toMatchObject({
      content: 'the answer',
      snapshotMode: 'replace',
      snapshotSeq: 1, // per-kind counters are independent
    });
  });

  it('resets the reasoning accumulator at stream boundaries', async () => {
    const { batches, sink } = createSink();
    const ingester = new CoalescingBatchIngester(sink);

    ingester.push(reasoningEvent('first thought'));
    ingester.push(makeEvent('stream_end'));
    ingester.push(makeEvent('stream_start', { newStep: true }));
    ingester.push(reasoningEvent('second thought'));
    await ingester.drain();

    const batch = batches.flat();
    expect(batch[0].data).toMatchObject({ reasoning: 'first thought', snapshotSeq: 1 });
    expect(batch[3].data).toMatchObject({ reasoning: 'second thought', snapshotSeq: 2 });
  });

  it('forwards subagent reasoning verbatim without snapshot conversion', async () => {
    const { batches, sink } = createSink();
    const ingester = new CoalescingBatchIngester(sink);

    const subagent = { parentToolCallId: 'task-1', subagentMessageId: 'msg-sub-1' };
    ingester.push(reasoningEvent('main think '));
    ingester.push(reasoningEvent('sub think', { subagent }));
    await ingester.drain();

    const batch = batches.flat();
    expect(batch[0].data).toMatchObject({ reasoning: 'main think ', snapshotMode: 'replace' });
    expect(batch[1].data).toMatchObject({ reasoning: 'sub think', subagent });
    expect((batch[1].data as any).snapshotMode).toBeUndefined();
  });

  it('forwards subagent text verbatim — no snapshot conversion, no accumulator pollution', async () => {
    const { batches, sink } = createSink();
    const ingester = new CoalescingBatchIngester(sink);

    const subagent = { parentToolCallId: 'task-1', subagentMessageId: 'msg-sub-1' };
    ingester.push(textEvent('main '));
    ingester.push(textEvent('I checked the files.', { subagent }));
    await ingester.drain();

    const batch = batches.flat();
    // Main snapshot flushed first (order preserved), untainted by the block.
    expect(batch[0].data).toMatchObject({ content: 'main ', snapshotMode: 'replace' });
    // Subagent block passes through untouched: same content, no snapshot
    // fields (the server's subagent path appends — replace semantics would
    // duplicate content there).
    expect(batch[1].data).toMatchObject({ content: 'I checked the files.', subagent });
    expect((batch[1].data as any).snapshotMode).toBeUndefined();
    expect((batch[1].data as any).snapshotSeq).toBeUndefined();
  });

  it('retries a failed batch with an identical payload, then keeps delivering later events', async () => {
    // Same-batch redelivery contract: `HeterogeneousPersistenceHandler.ingest`
    // marks events processed only on success and dedupes redelivered ones, so
    // the producer MUST re-send the failed batch as-is. The serial ingester
    // had dropped this retry entirely — one transient failure discarded every
    // subsequent event of the run.
    const batches: AgentStreamEvent[][] = [];
    const ingest = vi
      .fn(async (events: AgentStreamEvent[]) => {
        batches.push([...events]);
      })
      .mockRejectedValueOnce(new Error('ECONNRESET'));
    const ingester = new CoalescingBatchIngester({ finish: vi.fn(), ingest });

    ingester.push(toolEvent(1));
    ingester.push(toolEvent(2));
    const drained = ingester.drain();
    await vi.advanceTimersByTimeAsync(500); // first retry back-off
    await drained;

    expect(ingest).toHaveBeenCalledTimes(2);
    expect(ingest.mock.calls[1][0]).toEqual(ingest.mock.calls[0][0]);

    ingester.push(toolEvent(3));
    await ingester.drain();
    expect(batches.flat().map((event) => (event.data as any).toolCallId)).toEqual([
      'tc-1',
      'tc-2',
      'tc-3',
    ]);
  });

  it('drain rethrows once retries are exhausted so the CLI can finish(result: error)', async () => {
    const ingest = vi.fn(async () => {
      throw new Error('server down');
    });
    const ingester = new CoalescingBatchIngester({ finish: vi.fn(), ingest });

    ingester.push(toolEvent(1));
    const drained = ingester.drain();
    const assertion = expect(drained).rejects.toThrow('server down');
    // Back-off schedule: 500 + 1000 + 2000 + 4000 + 8000 ms.
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;

    expect(ingest).toHaveBeenCalledTimes(6); // initial + 5 retries
  });

  it('stops accumulating text once the batcher has failed (no undeliverable retention)', async () => {
    // Mirrors the serial ingester's fatal short-circuit: after retries are
    // exhausted nothing can be delivered, so later text deltas must be
    // dropped instead of retained in `accumulatedText` until process exit.
    const ingest = vi.fn(async () => {
      throw new Error('server down');
    });
    const ingester = new CoalescingBatchIngester({ finish: vi.fn(), ingest });

    ingester.push(toolEvent(1));
    const drained = ingester.drain();
    const assertion = expect(drained).rejects.toThrow('server down');
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;

    ingester.push(textEvent('undeliverable '));
    ingester.push(textEvent('response'));
    await vi.advanceTimersByTimeAsync(1000);

    // White-box on purpose — the regression IS the internal retention: the
    // accumulator stays empty, no snapshot is pending, no debounce armed.
    expect((ingester as any).accumulatedText).toBe('');
    expect((ingester as any).pendingTextEvent).toBeUndefined();
    expect((ingester as any).timer).toBeNull();

    // And nothing new ever reaches the sink; drain keeps rethrowing.
    const redrained = expect(ingester.drain()).rejects.toThrow('server down');
    await vi.advanceTimersByTimeAsync(20_000);
    await redrained;
    expect(ingest).toHaveBeenCalledTimes(6); // unchanged after the failure
  });
});
