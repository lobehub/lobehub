import debug from 'debug';

import { threadService } from '@/services/thread';
import { type ThreadItem } from '@/types/topic';

import {
  flushPendingBridgeCoordinates,
  readQueuedBridgePersist,
  registry,
  trackPending,
} from './registry';
import {
  type ClientSubAgentBridgeRegistration,
  type PersistedBridgeCoordinates,
  type SubAgentBridgeOutcome,
} from './types';

const log = debug('lobe-store:client-subagent-bridge');

/**
 * P1 (round-18): a reconstructed sibling whose thread is ALREADY settled has
 * no future terminal event — replay its completion with the outcome derived
 * from the settlement the original fire persisted.
 */
export interface SettledSiblingReplay {
  outcome: SubAgentBridgeOutcome;
  registration: SubAgentBridgeRegistration;
  /** Flat stats the original fire settled with (re-aggregating would zero them). */
  stats: Record<string, number | string | undefined>;
}
type SubAgentBridgeRegistration = Extract<ClientSubAgentBridgeRegistration, { kind: 'sub-agent' }>;

/**
 * Map a settled thread row back to the terminal outcome the original fire
 * settled it with: completed → done, failed → error (with the persisted
 * error string), anything else → interrupted. Cost / token totals ride on
 * the settlement metadata the original fire wrote.
 */
const deriveSettledState = (
  thread: ThreadItem,
): { outcome: SubAgentBridgeOutcome; stats: Record<string, number | string | undefined> } => {
  const metadata = (thread.metadata ?? {}) as {
    error?: unknown;
    model?: string;
    totalCost?: number;
    totalTokens?: number;
    totalToolCalls?: number;
  };
  const usage = metadata.totalTokens ? { total: metadata.totalTokens } : undefined;
  const stats: Record<string, number | string | undefined> = {
    model: metadata.model,
    totalCost: metadata.totalCost,
    totalTokens: metadata.totalTokens,
    totalToolCalls: metadata.totalToolCalls,
  };
  switch (thread.status) {
    case 'completed': {
      return {
        outcome: {
          ...usage,
          ...(metadata.totalCost !== undefined ? { cost: metadata.totalCost } : {}),
          status: 'done',
        },
        stats,
      };
    }
    case 'failed': {
      return {
        outcome: {
          ...usage,
          error: typeof metadata.error === 'string' ? metadata.error : undefined,
          status: 'error',
        },
        stats,
      };
    }
    default: {
      return { outcome: { status: 'interrupted' }, stats };
    }
  }
};

/**
 * Build the ARMED registration from one thread row's persisted coordinates
 * and claim it (registry + barrier slot). Pure row → registration mapping so
 * the sibling walk below can reuse it without refetching the topic.
 */
const buildRegistrationFromRow = (
  thread: ThreadItem,
  bridge: PersistedBridgeCoordinates,
): ClientSubAgentBridgeRegistration | undefined => {
  const childContext = {
    agentId: thread.agentId ?? undefined,
    ...(thread.groupId ? { groupId: thread.groupId } : {}),
    scope: 'thread',
    threadId: thread.id,
    topicId: thread.topicId,
  } as ClientSubAgentBridgeRegistration['childContext'];

  const registration: ClientSubAgentBridgeRegistration | undefined =
    bridge.kind === 'sub-agent'
      ? {
          armed: true,
          childContext,
          childOperationId: '',
          kind: 'sub-agent',
          parentContext:
            bridge.parentContext ?? ({} as ClientSubAgentBridgeRegistration['childContext']),
          parentOperationId: bridge.parentOperationId ?? '',
          toolMessageId: bridge.toolMessageId,
        }
      : {
          armed: true,
          childContext,
          childOperationId: '',
          kind: 'group-orchestration',
          memberAgentId: bridge.memberAgentId ?? childContext.agentId ?? '',
          messageContext:
            bridge.messageContext ?? ({} as ClientSubAgentBridgeRegistration['childContext']),
          orchestrationOperationId: bridge.orchestrationOperationId ?? '',
          supervisorAgentId: bridge.supervisorAgentId ?? '',
          supervisorSnapshot: bridge.supervisorSnapshot,
          toolMessageId: bridge.toolMessageId,
        };

  if (!registration) return undefined;
  trackPending(registration);
  registry.set(thread.id, registration);
  return registration;
};

/**
 * Post-reload reconstruction: the in-memory registry has no claim for this
 * child thread, but a parked child outlives a reload — its isolation thread
 * row still carries the persisted bridge coordinates and is still
 * `processing` (settling the child clears it). Rebuild an ARMED registration
 * from the coordinates and re-arm the barrier slot. Armed because the
 * persisted coordinates only exist once the parent parked; the `processing`
 * status check is what prevents a settled bridge from re-firing.
 *
 * Returns the rebuilt registration for THIS thread plus every SETTLED
 * sibling reconstructed along the way — a settled sibling never fires again
 * on its own (P1 round-18), so the caller must replay its completion or its
 * passive barrier slot parks the parent forever.
 */
export const reconstructRegistrationFromThread = async (
  childThreadId: string,
  childTopicId: string | undefined,
  // P2 (round-8): the sibling-rebuild loop already holds the full topic
  // thread list — pass it through instead of re-fetching the whole topic
  // once per sibling (N serial round-trips before the parent can resume).
  knownThreads?: Awaited<ReturnType<typeof threadService.getThreads>>,
): Promise<{
  registration: ClientSubAgentBridgeRegistration | undefined;
  settledSiblings: SettledSiblingReplay[];
}> => {
  const settledSiblings: SettledSiblingReplay[] = [];
  try {
    if (!childTopicId) return { registration: undefined, settledSiblings };
    // P1 (round-21): drain the durable persist queue BEFORE reading the
    // thread rows — a previous session's swallowed / cancelled coordinate
    // write lands here, so this very read can still reconstruct from it.
    // The flush never throws; a failed drain keeps the entry queued and the
    // flush driver will retry, while reconstruction continues with whatever
    // is on the row now.
    await flushPendingBridgeCoordinates();
    const threads = knownThreads ?? (await threadService.getThreads(childTopicId));
    const thread = threads.find((t) => t.id === childThreadId);
    if (!thread) return { registration: undefined, settledSiblings };

    // P1 (round-12): a settled child with SURVIVING coordinates is the
    // signature of a fire that crashed AFTER settlement (backfill / plugin
    // state / re-entry throw) — the success path clears the coordinates
    // right after `fireRegistration` resolves. A reload in that window used
    // to strand the parent forever, because this check rejected every
    // non-`processing` thread. Allow the continuation: re-firing settles an
    // already-settled child idempotently, and the parentParked guard (op
    // status / deferred placeholder) blocks phantom resumes of a parent that
    // already settled out-of-band.
    if (thread.status !== 'processing') {
      log(
        'bridge reconstruction on settled child %s (status=%s) — fire crashed after settlement, continuing the parent resume',
        childThreadId,
        thread.status,
      );
    }

    const bridge = (thread.metadata as { bridge?: PersistedBridgeCoordinates } | undefined)?.bridge;
    // P1 (round-23): the queue is a SECOND durable source. The `processing`
    // guard can reject the coordinate merge when the child settled before the
    // merge arrived — the row then never carries a `bridge`, and draining the
    // entry would strand the parent after a reload. Reconstruction reads the
    // queue entry (kept until the fire's success path drains it) before
    // concluding "no coordinates".
    // P1 (round-25): a normally completed (non-parked) child reaches this
    // same lookup with NEITHER source — registration only happens for
    // `{ parked: true }`, so the thread has no `metadata.bridge` and no
    // queue entry. The old fallthrough cast the `undefined` coordinates and
    // dereferenced `bridge.kind` inside `buildRegistrationFromRow`, and the
    // fire path's catch retried that deterministic throw forever (5/10/15/20s
    // then every 60s, refetching the topic's threads each pass). Absent
    // coordinates on both sources IS the "no bridge on this thread" shape —
    // return the silent no-op the fire path already handles.
    const queuedBridge = readQueuedBridgePersist(childThreadId)?.registration as
      PersistedBridgeCoordinates | undefined;
    if (!bridge && !queuedBridge) {
      return { registration: undefined, settledSiblings };
    }
    const registration = bridge
      ? buildRegistrationFromRow(thread, bridge)
      : buildRegistrationFromRow(thread, queuedBridge!);

    // P1 (round-7): a reload wipes the whole registry — reconstruct EVERY
    // parallel sibling parked on the same parent op too, or the first child
    // to finish tracks only itself and the barrier releases the parent while
    // its siblings are still running.
    // P1 (round-12): settled siblings with surviving coordinates are the
    // post-settlement-crash signature (see the top-of-function note) — they
    // must also reconstruct, or the barrier never releases for them.
    // P1 (round-18): a settled sibling also has no future terminal event to
    // release its slot — collect it so the caller replays its fire
    // (idempotent backfill + CAS slot release) instead of deadlocking.
    if (registration?.kind === 'sub-agent' && registration.parentOperationId) {
      for (const sibling of threads) {
        if (sibling.id === thread.id || registry.has(sibling.id)) continue;
        const siblingBridge = (
          sibling.metadata as { bridge?: PersistedBridgeCoordinates } | undefined
        )?.bridge;
        if (
          siblingBridge?.kind !== 'sub-agent' ||
          siblingBridge.parentOperationId !== registration.parentOperationId
        )
          continue;
        const siblingRegistration = buildRegistrationFromRow(sibling, siblingBridge);
        if (!siblingRegistration) continue;
        log('bridge sibling reconstructed from thread row: key=%s', sibling.id);
        if (sibling.status !== 'processing') {
          const derived = deriveSettledState(sibling);
          settledSiblings.push({
            outcome: derived.outcome,
            registration: siblingRegistration as SubAgentBridgeRegistration,
            stats: derived.stats,
          });
        }
      }
    }

    log(
      'bridge reconstructed from thread row (armed): key=%s kind=%s',
      childThreadId,
      bridge?.kind,
    );
    return { registration, settledSiblings };
  } catch (error) {
    // P1 (round-20): propagate instead of swallowing. The fire path
    // distinguishes "no bridge on this thread" (`registration: undefined` —
    // silent no-op) from "reconstruction itself failed" (throw): a swallowed
    // transient failure (threadService.getThreads rejecting…) used to exit
    // the fire path BEFORE its retry try/catch, leaving the parent parked
    // forever with no retry driver — the child's terminal boundary is the
    // only production trigger for that fire.
    log('bridge: failed to reconstruct registration for %s: %O', childThreadId, error);
    throw error;
  }
};
