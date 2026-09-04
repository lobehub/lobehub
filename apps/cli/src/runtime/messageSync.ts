import type { UpdateToolMessageInput } from '@lobechat/agent-runtime';
import type { CreateMessageParams, UpdateMessageParams } from '@lobechat/types';

/**
 * One durable mutation, in the shape the cloud's `message.batchMutate`
 * procedure accepts. Deliberately a narrow union rather than "whatever the
 * store did": the replica is rebuilt by replaying these, so anything not
 * expressible here would silently diverge.
 */
export type MessageSyncOperation =
  | { message: CreateMessageParams & { id: string }; type: 'createMessage' }
  | { id: string; type: 'updateMessage'; value: Partial<UpdateMessageParams> }
  | { id: string; type: 'updateToolMessage'; value: UpdateToolMessageInput };

/**
 * Where a locally executed run replicates its messages.
 *
 * A port, not a tRPC client, for two reasons: the queue is testable without a
 * network, and the CLI is not the only possible host for a local runtime.
 */
export interface MessageSyncSink {
  /**
   * Deliver a batch. MUST throw on failure so the queue can retry — a sink that
   * swallows errors turns a lost batch into silent data loss.
   *
   * MUST also be idempotent for a repeated identical batch. Redelivery is not
   * an edge case: a process that dies after the sink commits but before the
   * queue records the acknowledgement will replay that batch on restart, and
   * every operation carries a locally-minted id, so the retry is byte-identical.
   * A sink backed by a plain insert will reject it as a duplicate.
   *
   * The cloud procedure caps a batch at 200 operations; the queue respects that.
   */
  flush: (operations: MessageSyncOperation[]) => Promise<void>;
  /**
   * Classify a `flush` rejection as "these rows are already there".
   *
   * Without this a single replayed batch is fatal: it fails forever, exhausts
   * the retries, and stops ALL later replication — one crash at the wrong
   * moment silently ends the cloud replica for the rest of the run. Sinks whose
   * backend cannot express an upsert use this to acknowledge a duplicate
   * instead.
   */
  isAlreadyApplied?: (error: unknown) => boolean;
}

/** Cloud limit on one `message.batchMutate` call. */
export const MAX_SYNC_BATCH = 200;

/** Drops everything. For runs that deliberately keep no cloud replica. */
export class NoopMessageSyncSink implements MessageSyncSink {
  async flush(): Promise<void> {}
}
