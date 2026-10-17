import { type ConversationContext } from '@lobechat/types';
import debug from 'debug';

import { threadService } from '@/services/thread';

import {
  type ClientSubAgentBridgeRegistration,
  type PersistedBridgeCoordinates,
  type SubAgentBridgeOutcome,
} from './types';

const log = debug('lobe-store:client-subagent-bridge');

export const registry = new Map<string, ClientSubAgentBridgeRegistration>();

/**
 * Parallel-call barrier: one parent turn may emit several `callSubAgent`
 * calls (systemRole documents parallel dispatch). All of them park the same
 * parent op, so the parent may only resume after the LAST child settles.
 * Keyed by the shared parked parent op id; each registration carries its own
 * tool message, so backfills stay per-child while the resume is barriered.
 */
export const pendingByParentOp = new Map<string, Set<string>>();

/**
 * Terminal outcomes held while a registration was still unarmed — replayed by
 * arming at the parent park (the child has no second terminal boundary). Cleared
 * per thread on replay; the test reset clears everything.
 */
export const heldCompletions = new Map<string, SubAgentBridgeOutcome>();

/**
 * Scheduled automatic re-fires after a failed fire (P1 round-10): the child's
 * terminal boundary was the only production caller, so a restored claim with
 * no driver left the parent parked forever. Keyed by child threadId; the
 * timer consumes its own entry before re-firing, so a later failure can
 * schedule the next attempt. Cleared per thread when the timer fires; the
 * test reset clears (and cancels) everything.
 */
export const scheduledBridgeRetries = new Map<
  string,
  { attempt: number; timer: ReturnType<typeof setTimeout> }
>();

export const clearScheduledBridgeRetries = (): void => {
  for (const { timer } of scheduledBridgeRetries.values()) clearTimeout(timer);
  scheduledBridgeRetries.clear();
};

/**
 * Test-only reset: the registry is module-level shared state, and a restored
 * claim (retry semantics) must not leak across test cases. Not exported from
 * the package index.
 */
export const __resetBridgeForTests = (): void => {
  heldCompletions.clear();
  registry.clear();
  pendingByParentOp.clear();
  clearScheduledBridgeRetries();
  // The persist queue is durable (localStorage) — tests must start empty and
  // a pending flush timer must not leak across cases.
  try {
    localStorage.removeItem(BRIDGE_PERSIST_QUEUE_KEY);
  } catch {
    // jsdom-less environments may not have localStorage at all
  }
  if (persistFlushTimer) {
    clearTimeout(persistFlushTimer);
    persistFlushTimer = undefined;
  }
  persistFlushAttempts = 0;
};

/**
 * Test-only: simulate a renderer reload — the in-memory registry dies while
 * the durable persist queue (localStorage) survives. `__resetBridgeForTests`
 * clears BOTH, so it cannot model a reload that keeps the queue.
 */
export const __clearRegistryForTests = (): void => {
  registry.clear();
  pendingByParentOp.clear();
};

export const trackPending = (registration: ClientSubAgentBridgeRegistration) => {
  const parentOpId =
    registration.kind === 'sub-agent'
      ? registration.parentOperationId
      : registration.orchestrationOperationId;
  let pending = pendingByParentOp.get(parentOpId);
  if (!pending) {
    pending = new Set<string>();
    pendingByParentOp.set(parentOpId, pending);
  }
  pending.add(registration.toolMessageId);
};

export const releasePending = (registration: ClientSubAgentBridgeRegistration): boolean => {
  const parentOpId =
    registration.kind === 'sub-agent'
      ? registration.parentOperationId
      : registration.orchestrationOperationId;
  const pending = pendingByParentOp.get(parentOpId);
  if (!pending) return true;
  pending.delete(registration.toolMessageId);
  if (pending.size === 0) {
    pendingByParentOp.delete(parentOpId);
    return true;
  }
  return false;
};

const registryKey = (childContext: ConversationContext): string | undefined =>
  childContext.threadId ?? undefined;

const toPersistedCoordinates = (
  registration: ClientSubAgentBridgeRegistration,
): PersistedBridgeCoordinates =>
  registration.kind === 'sub-agent'
    ? {
        kind: registration.kind,
        parentContext: registration.parentContext,
        parentOperationId: registration.parentOperationId,
        toolMessageId: registration.toolMessageId,
      }
    : {
        kind: registration.kind,
        memberAgentId: registration.memberAgentId,
        messageContext: registration.messageContext,
        orchestrationOperationId: registration.orchestrationOperationId,
        supervisorAgentId: registration.supervisorAgentId,
        supervisorSnapshot: registration.supervisorSnapshot,
        toolMessageId: registration.toolMessageId,
      };

/**
 * Merge the bridge coordinates into the child thread's metadata.
 * P2 (bridge round-18): the write is an ATOMIC top-level merge executed
 * server-side (`mergeThreadMetadata` → `ThreadModel.mergeMetadata`), guarded
 * on the thread still being `processing`. The old read-modify-write with a
 * whole-blob replace raced thread settlement: a settlement landing between
 * the read and the write clobbered the just-written terminal fields
 * (completedAt / cost / token totals) with the stale pre-settlement snapshot.
 *
 * P1 (bridge round-21): the write is no longer a bare fire-and-forget. A
 * transient failure (or an in-flight request cancelled by a reload) used to
 * be swallowed here while `metadata.bridge` is the ONLY durable coordinate
 * source for the post-reload reconstruction — that thread would then
 * reconstruct nothing after the reload and the parked parent stayed parked
 * forever. The coordinates are now write-ahead enqueued into a durable
 * localStorage queue BEFORE the request fires, and every failure keeps the
 * entry queued for the flush driver (`flushPendingBridgeCoordinates`), which
 * reconstruction runs BEFORE reading the thread rows.
 */
const BRIDGE_PERSIST_QUEUE_KEY = 'LOBE_CLIENT_SUB_AGENT_BRIDGE_PERSIST_QUEUE';
/** ≈1h of slow-poll (4×5s..20s burst + 60s poll) before an entry is dropped. */
const PERSIST_FLUSH_MAX_ATTEMPTS = 60;

interface QueuedBridgePersist {
  attempts: number;
  childThreadId: string;
  childTopicId?: string;
  enqueuedAt: number;
  registration: ClientSubAgentBridgeRegistration;
}

const readPersistQueue = (): QueuedBridgePersist[] => {
  try {
    const raw = localStorage.getItem(BRIDGE_PERSIST_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedBridgePersist[]) : [];
  } catch {
    return [];
  }
};

const writePersistQueue = (queue: QueuedBridgePersist[]): void => {
  try {
    if (queue.length === 0) localStorage.removeItem(BRIDGE_PERSIST_QUEUE_KEY);
    else localStorage.setItem(BRIDGE_PERSIST_QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    log('bridge: failed to write the persist queue: %O', error);
  }
};

const enqueueBridgePersist = (
  childThreadId: string,
  childTopicId: string | undefined,
  registration: ClientSubAgentBridgeRegistration,
): number => {
  const queue = readPersistQueue().filter((entry) => entry.childThreadId !== childThreadId);
  const enqueuedAt = Date.now();
  queue.push({
    attempts: 0,
    childThreadId,
    childTopicId,
    enqueuedAt,
    registration,
  });
  writePersistQueue(queue);
  return enqueuedAt;
};

/**
 * Remove one queued entry by thread id. When `enqueuedAt` is given, the
 * removal only applies to THAT enqueue: a re-registration of the same thread
 * during an in-flight flush (fresh `enqueuedAt`) survives the flush's drain.
 */
export const removeQueuedBridgePersist = (childThreadId: string, enqueuedAt?: number): void => {
  writePersistQueue(
    readPersistQueue().filter(
      (entry) =>
        !(
          entry.childThreadId === childThreadId &&
          (enqueuedAt === undefined || entry.enqueuedAt === enqueuedAt)
        ),
    ),
  );
};

/** Read the queued entry for one child thread (reconstruction's fallback source). */
export const readQueuedBridgePersist = (childThreadId: string): QueuedBridgePersist | undefined =>
  readPersistQueue().find((entry) => entry.childThreadId === childThreadId);

/**
 * Durably increment one entry's attempt counter (matched on `enqueuedAt`).
 * Returns the new count, or 0 when the entry was replaced / removed
 * mid-flight — a stale counter bump must not land on a fresh enqueue.
 */
const bumpQueuedEntryAttempts = (childThreadId: string, enqueuedAt: number): number => {
  const queue = readPersistQueue();
  const entry = queue.find((e) => e.childThreadId === childThreadId && e.enqueuedAt === enqueuedAt);
  if (!entry) return 0;
  entry.attempts += 1;
  writePersistQueue(queue);
  return entry.attempts;
};

let persistFlushTimer: ReturnType<typeof setTimeout> | undefined;
let persistFlushAttempts = 0;

const schedulePersistFlush = (): void => {
  // Single queue-level driver (not per key): every exit reschedules the next
  // burst step, mirroring the fire retry's bounded-burst + slow-poll shape.
  if (persistFlushTimer) return;
  persistFlushAttempts += 1;
  const delay = persistFlushAttempts <= 4 ? 5000 * persistFlushAttempts : 60_000;
  persistFlushTimer = setTimeout(() => {
    persistFlushTimer = undefined;
    void flushPendingBridgeCoordinates();
  }, delay);
  log('bridge persist flush %d scheduled in %dms', persistFlushAttempts, delay);
};

/**
 * Re-write every queued coordinate entry. Success (or a `processing`-guard
 * rejection — the row settled or is gone, the coordinates are stale) drains
 * the entry; a failure keeps it queued and schedules the next flush. Never
 * throws: reconstruction runs this ahead of its own reads, and a flush
 * failure must not be conflated with "no bridge on this thread".
 *
 * Drain is PER-ENTRY removal against a fresh queue read (never a whole-blob
 * rewrite of a stale snapshot): a registration enqueueing while a flush is
 * mid-flight must not lose its entry to the flush's write — the same
 * read-modify-write race the round-18 P2 fix removed from the metadata
 * merge itself.
 */
export const flushPendingBridgeCoordinates = async (): Promise<void> => {
  const queue = readPersistQueue();
  if (queue.length === 0) {
    persistFlushAttempts = 0;
    return;
  }
  let failed = false;
  for (const entry of queue) {
    const attempts = bumpQueuedEntryAttempts(entry.childThreadId, entry.enqueuedAt);
    // 0 = the entry was replaced or removed mid-flight — its successor owns
    // the retry, this loop iteration is operating on a stale snapshot.
    if (attempts === 0) continue;
    if (attempts > PERSIST_FLUSH_MAX_ATTEMPTS) {
      log(
        'bridge: persist queue entry for %s dropped after %d attempts (enqueued at %d)',
        entry.childThreadId,
        attempts,
        entry.enqueuedAt,
      );
      removeQueuedBridgePersist(entry.childThreadId, entry.enqueuedAt);
      continue;
    }
    if (!entry.childTopicId) {
      removeQueuedBridgePersist(entry.childThreadId, entry.enqueuedAt);
      continue;
    }
    try {
      const applied = await threadService.mergeThreadMetadata(entry.childThreadId, {
        bridge: toPersistedCoordinates(entry.registration),
      });
      if (applied) log('bridge: queued coordinates flushed to thread %s', entry.childThreadId);
      else
        log(
          'bridge: queued coordinates flush rejected for %s (processing guard) — entry retained',
          entry.childThreadId,
        );
      // P1 (round-23): a `false` here is NOT proof the coordinates are stale —
      // the guard can reject because the child settled BEFORE this merge
      // arrived, while the row never received the bridge at all (the write
      // that raced settlement lost). Draining on `false` discarded the only
      // lifeline in that ordering (settlement-before-persistence + reload
      // stranded the parent). The entry is retained until the fire's success
      // path drains it explicitly (`removeQueuedBridgePersist` after the
      // parent re-entry is launched) or the attempt cap expires.
      if (!applied) {
        failed = true;
        continue;
      }
      // An APPLIED flush means the row now carries the coordinates — the
      // entry is drained (the enqueuedAt guard keeps a same-thread
      // re-registration that landed during the await intact).
      removeQueuedBridgePersist(entry.childThreadId, entry.enqueuedAt);
    } catch (error) {
      log('bridge: queued coordinates flush failed for %s: %O', entry.childThreadId, error);
      failed = true;
    }
  }
  if (failed) schedulePersistFlush();
  else if (readPersistQueue().length === 0) persistFlushAttempts = 0;
};

const persistBridgeCoordinates = async (
  childThreadId: string,
  childTopicId: string | undefined,
  registration: ClientSubAgentBridgeRegistration,
): Promise<void> => {
  if (!childTopicId) return;
  // Write-ahead: the queue entry is durable BEFORE the request fires, so a
  // reload cancelling the in-flight request still leaves it behind for the
  // next flush.
  const enqueuedAt = enqueueBridgePersist(childThreadId, childTopicId, registration);
  try {
    const applied = await threadService.mergeThreadMetadata(childThreadId, {
      bridge: toPersistedCoordinates(registration),
    });
    // Skipped = the thread already settled (the `processing` guard) — the
    // coordinates may be stale OR the row may have settled before any bridge
    // write landed (P1 round-23: settlement-before-persistence). Draining on
    // `false` discarded the only lifeline in the latter ordering; the entry
    // is retained for the fire's success path / attempt cap instead.
    if (!applied) {
      log(
        'bridge coordinates persistence skipped for %s (thread already settled) — queue entry retained',
        childThreadId,
      );
      return;
    }
    removeQueuedBridgePersist(childThreadId, enqueuedAt);
    log('bridge coordinates persisted to thread %s', childThreadId);
  } catch (error) {
    // P1 (round-21): recoverable instead of swallowed — the entry stays
    // queued and the flush driver retries. Loud log for diagnosis.
    log(
      'bridge: failed to persist coordinates for %s (queued for flush retry): %O',
      childThreadId,
      error,
    );
    schedulePersistFlush();
  }
};

export const registerClientSubAgentBridge = (registration: ClientSubAgentBridgeRegistration) => {
  const key = registryKey(registration.childContext);
  if (!key) {
    log('bridge registration skipped: child context has no threadId');
    return;
  }
  // Two-phase activation: default unarmed. Only the group park-exit passes
  // `armed: true` (its park is already fully formed); the sub-agent spawner
  // registers BEFORE the parent's deferred pause assembles, so its
  // registration arms later — at the parent's actual park, inside
  // `armClientSubAgentBridgesForContext`.
  registry.set(key, { armed: false, ...registration });
  trackPending(registration);
  log(
    'bridge registered (armed=%s): key=%s kind=%s toolMessage=%s',
    String(registration.armed ?? false),
    key,
    registration.kind,
    registration.toolMessageId,
  );
  // Post-reload lifeline: the in-memory registry dies with the renderer, the
  // parked child does not. Fire-and-forget — a persistence failure must not
  // break the park.
  void persistBridgeCoordinates(key, registration.childContext.topicId ?? undefined, registration);
};

/**
 * Spawner-side registration for `runClientSubAgent` (streamingExecutor): the
 * parked child's context + the parent run's coordinates. Kept here so the
 * oversized streamingExecutor file only carries a one-line call — AGENTS.md
 * forbids growing files already over the 800-line limit.
 */
export const registerSubAgentBridgeFromSpawner = (params: {
  childContext: ConversationContext;
  childOperationId: string;
  /**
   * Operation lookup — the bridge reads the FULL parent context
   * (threadId / scope / documentId / workspaceSlug / groupId …) from
   * `getParentOperation(parentOperationId)?.context` itself, so the resume
   * reconstructs the parent's message bucket in the original scope. A
   * spawner-side trimmed context made thread- and page-scoped parents resume
   * into the main-topic bucket (messageMapKey isolation).
   */
  getParentOperation: (
    parentOperationId: string,
  ) => { context?: unknown; status: string } | undefined;
  parentAgentId: string;
  parentOperationId?: string;
  toolMessageId: string;
}): void => {
  const {
    childContext,
    childOperationId,
    getParentOperation,
    parentAgentId,
    parentOperationId,
    toolMessageId,
  } = params;

  // No parent op id (legacy spawner) → no bridge to hang the resume on.
  if (!parentOperationId) return;
  const parentOp = getParentOperation(parentOperationId);
  if (!parentOp) return;

  registerClientSubAgentBridge({
    childContext,
    childOperationId,
    kind: 'sub-agent',
    parentContext: {
      // Full parent context (see doc above); agentId pinned to the spawner's
      // value. The operation context extends ConversationContext.
      ...(parentOp.context as ConversationContext | undefined),
      agentId: parentAgentId,
    },
    parentOperationId,
    toolMessageId,
  });
};

/**
 * Member-side registration for the group-orchestration park-exit: the parked
 * member's context + the orchestration's coordinates. Same size rationale as
 * the spawner-side helper above.
 */
export const registerGroupBridgeFromParkExit = (params: {
  childContext: ConversationContext;
  childOperationId: string;
  memberAgentId: string;
  messageContext: ConversationContext;
  orchestrationOperationId: string;
  supervisorAgentId: string;
  /** Supervisor counters at the park point, restored by the re-entry. */
  supervisorSnapshot?: PersistedBridgeCoordinates['supervisorSnapshot'];
  toolMessageId: string;
}): void => {
  // Armed at registration: the group park-exit runs AFTER the orchestration
  // loop has already ended its turn with `result: undefined` — the park is
  // fully formed at this point (the loop will not assemble any further
  // deferred pause that could race the resume), unlike the sub-agent spawner
  // whose parent may still be executing sibling tool lanes.
  registerClientSubAgentBridge({
    armed: true,
    childContext: params.childContext,
    childOperationId: params.childOperationId,
    kind: 'group-orchestration',
    memberAgentId: params.memberAgentId,
    messageContext: params.messageContext,
    orchestrationOperationId: params.orchestrationOperationId,
    supervisorAgentId: params.supervisorAgentId,
    supervisorSnapshot: params.supervisorSnapshot,
    toolMessageId: params.toolMessageId,
  });
};
