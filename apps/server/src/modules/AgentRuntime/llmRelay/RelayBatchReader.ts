import type { LlmRelayBatch, LlmRelayDeadlines } from '@lobechat/agent-gateway-client';
import type Redis from 'ioredis';

/** What the server keeps of an uploaded batch (the uploader is settled by the lease). */
export type StoredRelayBatch = Pick<LlmRelayBatch, 'chunks' | 'final' | 'seq'>;

export type RelayDeadline = 'claim' | 'first_chunk' | 'gap' | 'idle' | 'total';

export type RelayReadResult =
  | { batch: StoredRelayBatch; kind: 'batch' }
  | { kind: 'aborted' }
  | { kind: 'timeout'; which: RelayDeadline };

/**
 * Upper bound of one blocking read, so an abort or a deadline is noticed
 * within this window even when nothing arrives.
 */
const POLL_MS = 2000;
const READ_COUNT = 100;

/**
 * Reads the batches of one relayed attempt from its Redis Stream in `seq`
 * order (T-540 §4.1): a batch at or below the last delivered `seq` is a
 * duplicate and dropped; one ahead of it waits until the gap fills. Owns a
 * dedicated (blocking) Redis connection.
 *
 * Deadlines (T-540 §4.3), all measured on the server:
 * - `claim`: no batch at all within `claimMs` of dispatch — nobody picked it up
 * - `first_chunk`: claimed, but no non-empty batch within `firstChunkMs`
 * - `idle` / `gap`: nothing delivered for `idleMs` (with a batch stuck behind
 *   a missing one: `gap`); idle executors heartbeat with empty batches
 * - `total`: the whole attempt, from dispatch
 */
export class RelayBatchReader {
  private claimedAt?: number;
  private firstChunkAt?: number;
  private lastDeliveredAt?: number;
  private lastSeq = 0;
  private lastStreamId = '0-0';
  private readonly pending = new Map<number, StoredRelayBatch>();

  constructor(
    private readonly redis: Redis,
    private readonly streamKey: string,
    private readonly deadlines: LlmRelayDeadlines,
    private readonly dispatchedAt: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** A non-empty chunk has been delivered. */
  get hasOutput() {
    return this.firstChunkAt !== undefined;
  }

  /** Release the dedicated connection. */
  close() {
    this.redis.disconnect();
  }

  async next(signal?: AbortSignal): Promise<RelayReadResult> {
    for (;;) {
      const ready = this.pending.get(this.lastSeq + 1);
      if (ready) return { batch: this.deliver(ready), kind: 'batch' };

      if (signal?.aborted) return { kind: 'aborted' };

      const deadline = this.nextDeadline();
      const now = this.now();
      if (now >= deadline.at) return { kind: 'timeout', which: deadline.which };

      await this.read(Math.max(1, Math.min(POLL_MS, deadline.at - now)));
    }
  }

  private deliver(batch: StoredRelayBatch) {
    this.pending.delete(batch.seq);
    this.lastSeq = batch.seq;
    this.lastDeliveredAt = this.now();
    if (this.firstChunkAt === undefined && batch.chunks.length > 0) {
      this.firstChunkAt = this.lastDeliveredAt;
    }
    return batch;
  }

  private nextDeadline(): { at: number; which: RelayDeadline } {
    const candidates: { at: number; which: RelayDeadline }[] = [
      { at: this.dispatchedAt + this.deadlines.totalMs, which: 'total' },
    ];

    if (this.claimedAt === undefined) {
      candidates.push({ at: this.dispatchedAt + this.deadlines.claimMs, which: 'claim' });
    } else {
      if (this.firstChunkAt === undefined) {
        candidates.push({ at: this.claimedAt + this.deadlines.firstChunkMs, which: 'first_chunk' });
      }
      candidates.push({
        at: (this.lastDeliveredAt ?? this.claimedAt) + this.deadlines.idleMs,
        which: this.pending.size > 0 ? 'gap' : 'idle',
      });
    }

    return candidates.reduce((earliest, candidate) =>
      candidate.at < earliest.at ? candidate : earliest,
    );
  }

  private async read(blockMs: number) {
    const result = (await this.redis.xread(
      'COUNT',
      READ_COUNT,
      'BLOCK',
      blockMs,
      'STREAMS',
      this.streamKey,
      this.lastStreamId,
    )) as [string, [string, string[]][]][] | null;

    for (const [, entries] of result ?? []) {
      for (const [id, fields] of entries) {
        this.lastStreamId = id;
        const batch = parseEntry(fields);
        if (!batch) continue;

        this.claimedAt ??= this.now();
        if (batch.seq <= this.lastSeq || this.pending.has(batch.seq)) continue;
        this.pending.set(batch.seq, batch);
      }
    }
  }
}

const parseEntry = (fields: string[]): StoredRelayBatch | undefined => {
  const values: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) values[fields[i]] = fields[i + 1];

  try {
    const batch = JSON.parse(values.body) as StoredRelayBatch;
    if (!Number.isInteger(batch.seq) || !Array.isArray(batch.chunks)) return;
    return batch;
  } catch {
    return;
  }
};
