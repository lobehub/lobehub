import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';

import { BatchIngester, type IngestSink } from './BatchIngester';

/**
 * Server ingester for `lh hetero exec`: coalesces main-agent text and
 * reasoning deltas into `replace` snapshots, then ships every event through
 * `BatchIngester` (≤50 events/batch, lazy-splice worker, 5-retry back-off)
 * instead of one serial tRPC round-trip per event.
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
 *
 * Reasoning gets the same snapshot treatment as text (this change): `replace`
 * snapshots are idempotent under batch redelivery — including a retry landing
 * on a cold replica whose in-memory publish/persistence latches are empty —
 * whereas raw deltas re-append and durably duplicate content.
 */
export class CoalescingBatchIngester {
  private accumulatedReasoning = '';
  private accumulatedText = '';
  private readonly batcher: BatchIngester;
  private nextReasoningSnapshotSeq = 0;
  private nextTextSnapshotSeq = 0;
  private pendingReasoningEvent: AgentStreamEvent | undefined;
  private pendingTextEvent: AgentStreamEvent | undefined;
  // Shared debounce: at most ONE kind is pending at a time — a delta of the
  // other kind flushes it first (see push) — so one timer covers both.
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
    // drop later events — including text/reasoning deltas — instead of
    // retaining an undeliverable response in memory until the process exits.
    if (this.batcher.failed) {
      this.accumulatedReasoning = '';
      this.accumulatedText = '';
      this.pendingReasoningEvent = undefined;
      this.pendingTextEvent = undefined;
      this.clearTimer();
      return;
    }

    // Snapshot coalescing is a MAIN-AGENT-ONLY transport optimization: it
    // debounces the main agent's token-level text/reasoning *deltas* into one
    // `replace` snapshot to cut ingest volume — and `replace` makes the
    // content idempotent under batch redelivery. Subagent chunks are
    // explicitly excluded (`!event.data?.subagent`) for two reasons:
    //   1. Subagent text is emitted as ONE full block per turn (see
    //      claudeCode adapter `handleSubagentAssistant` — "the full block IS
    //      the only emission"), so there is nothing to coalesce.
    //   2. The accumulators are single shared buffers with no subagent
    //      scope. Folding subagent blocks in would (a) splice main-agent text
    //      into the subagent message via the shared buffer, and (b) emit a
    //      `replace` snapshot that the server's subagent path *appends*
    //      (`persistSubagentText` has no snapshot semantics) → duplicated /
    //      cross-scope content. Forwarding the raw block straight through lets
    //      the server append it exactly once, correctly.
    if (this.isMainDelta(event, 'text')) {
      // Reasoning precedes text within a message — flush a pending reasoning
      // snapshot first so within-batch order matches emission order.
      this.flushPendingReasoningSnapshot();
      this.accumulatedText += event.data.content;
      this.pendingTextEvent = event;
      this.armTimer();
      return;
    }

    if (this.isMainDelta(event, 'reasoning')) {
      this.flushPendingTextSnapshot();
      this.accumulatedReasoning += event.data.reasoning;
      this.pendingReasoningEvent = event;
      this.armTimer();
      return;
    }

    // Flush pending snapshots BEFORE the incoming event enters the batch,
    // so within-batch order matches emission order (the server processes a
    // batch sequentially — a boundary or tool event must not overtake the
    // snapshot that preceded it). Reasoning first: it precedes text in the
    // adapters' emission order, and the two land in separate message fields
    // so the relative order between them cannot corrupt state.
    this.flushPendingReasoningSnapshot();
    this.flushPendingTextSnapshot();
    // The accumulators are PER-MESSAGE: they coalesce the deltas of the
    // current assistant message into one `replace` snapshot each. A new
    // message boundary (`stream_start` / `stream_end`, emitted by the
    // adapter's `openMainMessage`) must reset them — otherwise they span the
    // whole run and every later message's snapshot re-emits all prior
    // messages' content verbatim, which the server then persists into the new
    // DB message: cross-message duplication. Reset AFTER flushing the
    // just-ended message's pending snapshots above.
    if (event.type === 'stream_start' || event.type === 'stream_end') {
      this.accumulatedReasoning = '';
      this.accumulatedText = '';
    }
    this.batcher.push(event);
  }

  /** Flush any pending snapshots + buffered batches; rethrows the batcher's
   *  fatal error after its retries are exhausted. Call before `sink.finish`. */
  async drain(): Promise<void> {
    this.flushPendingReasoningSnapshot();
    this.flushPendingTextSnapshot();
    await this.batcher.drain();
  }

  private isMainDelta(
    event: AgentStreamEvent,
    kind: 'reasoning' | 'text',
  ): event is AgentStreamEvent & { data: Record<string, any> } {
    return (
      event.type === 'stream_chunk' &&
      event.data?.chunkType === kind &&
      typeof event.data?.[kind === 'text' ? 'content' : 'reasoning'] === 'string' &&
      !event.data?.subagent
    );
  }

  private armTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushPendingReasoningSnapshot();
      this.flushPendingTextSnapshot();
    }, this.snapshotFlushMs);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private flushPendingTextSnapshot() {
    if (!this.pendingTextEvent) return;
    this.clearTimer();

    const baseEvent = this.pendingTextEvent;
    this.pendingTextEvent = undefined;
    this.batcher.push({
      ...baseEvent,
      data: {
        ...baseEvent.data,
        content: this.accumulatedText,
        snapshotMode: 'replace',
        snapshotSeq: ++this.nextTextSnapshotSeq,
      },
    });
  }

  private flushPendingReasoningSnapshot() {
    if (!this.pendingReasoningEvent) return;
    this.clearTimer();

    const baseEvent = this.pendingReasoningEvent;
    this.pendingReasoningEvent = undefined;
    this.batcher.push({
      ...baseEvent,
      data: {
        ...baseEvent.data,
        reasoning: this.accumulatedReasoning,
        snapshotMode: 'replace',
        snapshotSeq: ++this.nextReasoningSnapshotSeq,
      },
    });
  }
}
