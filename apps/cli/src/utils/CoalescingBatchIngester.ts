import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';

import { BatchIngester, type IngestSink } from './BatchIngester';

/**
 * Server ingester for `lh hetero exec`: coalesces main-agent text deltas into
 * `replace` snapshots, then ships every event through `BatchIngester`
 * (≤50 events/batch, 250 ms flush, 5-retry back-off) instead of one serial
 * tRPC round-trip per event.
 *
 * History: #15197 replaced the original `BatchIngester` wiring with a
 * single-event serial ingester while introducing the snapshot semantics. That
 * made ingest throughput ~1 event per server round-trip — slower than agents
 * emit events — so long tool-heavy runs kept uploading for many minutes after
 * the CLI agent had already finished (`drain()` must clear the queue before
 * `heteroFinish`). Batching restores throughput; the snapshot coalescing and
 * its ordering/reset semantics are preserved here, and the server contract
 * (`HeterogeneousPersistenceHandler.ingest`) has always accepted ordered
 * event arrays and expected a retrying batch producer.
 */
export class CoalescingBatchIngester {
  private accumulatedText = '';
  private readonly batcher: BatchIngester;
  private nextSnapshotSeq = 0;
  private pendingTextEvent: AgentStreamEvent | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    sink: IngestSink,
    private readonly snapshotFlushMs = 200,
  ) {
    this.batcher = new BatchIngester(sink);
  }

  push(event: AgentStreamEvent): void {
    // Mirror the previous serial ingester's fatal short-circuit: once the
    // batcher has exhausted its retries nothing can ever be delivered, so
    // drop later events — including text deltas — instead of retaining an
    // undeliverable response in `accumulatedText` until the process exits.
    if (this.batcher.failed) {
      this.accumulatedText = '';
      this.pendingTextEvent = undefined;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      return;
    }

    // Text-snapshot coalescing is a MAIN-AGENT-ONLY transport optimization:
    // it debounces the main agent's token-level text *deltas* into one
    // `replace` snapshot to cut ingest volume. Subagent text is explicitly
    // excluded (`!event.data?.subagent`) for two reasons:
    //   1. Subagent text is emitted as ONE full block per turn (see
    //      claudeCode adapter `handleSubagentAssistant` — "the full block IS
    //      the only emission"), so there is nothing to coalesce.
    //   2. `accumulatedText` is a single shared accumulator with no subagent
    //      scope. Folding subagent blocks in would (a) splice main-agent text
    //      into the subagent message via the shared buffer, and (b) emit a
    //      `replace` snapshot that the server's subagent path *appends*
    //      (`persistSubagentText` has no snapshot semantics) → duplicated /
    //      cross-scope content. Forwarding the raw block straight through lets
    //      the server append it exactly once, correctly.
    if (
      event.type === 'stream_chunk' &&
      event.data?.chunkType === 'text' &&
      typeof event.data?.content === 'string' &&
      !event.data?.subagent
    ) {
      this.accumulatedText += event.data.content;
      this.pendingTextEvent = event;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flushPendingTextSnapshot();
      }, this.snapshotFlushMs);
      return;
    }

    // Flush the pending snapshot BEFORE the incoming event enters the batch,
    // so within-batch order matches emission order (the server processes a
    // batch sequentially — a boundary or tool event must not overtake the
    // text snapshot that preceded it).
    this.flushPendingTextSnapshot();
    // `accumulatedText` is a PER-MESSAGE accumulator: it coalesces the text
    // deltas of the current assistant message into one `replace` snapshot.
    // A new message boundary (`stream_start` / `stream_end`, emitted by the
    // adapter's `openMainMessage`) must reset it — otherwise it spans the
    // whole run and every later message's snapshot re-emits all prior
    // messages' text verbatim, which the server then persists into the new
    // DB message: cross-message text duplication. Reset AFTER flushing the
    // just-ended message's pending snapshot above.
    if (event.type === 'stream_start' || event.type === 'stream_end') {
      this.accumulatedText = '';
    }
    this.batcher.push(event);
  }

  /** Flush any pending snapshot + buffered batches; rethrows the batcher's
   *  fatal error after its retries are exhausted. Call before `sink.finish`. */
  async drain(): Promise<void> {
    this.flushPendingTextSnapshot();
    await this.batcher.drain();
  }

  private flushPendingTextSnapshot() {
    if (!this.pendingTextEvent) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const baseEvent = this.pendingTextEvent;
    this.pendingTextEvent = undefined;
    this.batcher.push({
      ...baseEvent,
      data: {
        ...baseEvent.data,
        content: this.accumulatedText,
        snapshotMode: 'replace',
        snapshotSeq: ++this.nextSnapshotSeq,
      },
    });
  }
}
