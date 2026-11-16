import type { QueuedFollowUpWaitReason } from '@lobechat/types';

import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { foldLegacyUserMessageFields } from '@/server/routers/lambda/aiAgent/execSchemas';
import { redisService } from '@/server/services/redis';
import type { SteerQueueScope } from '@/server/services/redis/steerQueue';

import { type HeteroSteerHold, heteroSteerHoldReason, loadAttachmentTypes } from './holdReason';
import type { QueuedFollowUp } from './index';

/**
 * What a heterogeneous run's producer (`lh hetero exec`) last reported about
 * taking queued follow-ups into its live session. It is the evidence for "why
 * is my message still queued": without it a run whose CLI never asks, one that
 * holds a message back, and one whose session closed all look the same.
 */
export interface HeteroSteerListener {
  acceptsAttachedImages?: boolean;
  acceptsImages?: boolean;
  /** The agent the run belongs to; a follow-up for another agent waits. */
  agentId: string | null;
  /** The producer's `lh` version, when it reports one. */
  cliVersion?: string;
  /** The queued follow-up the producer holds back, and why. */
  hold?: HeteroSteerHold;
  polledAt: number;
  /** `closed`: the session stopped taking input; the rest waits for the run to end. */
  state: 'closed' | 'listening';
}

/**
 * A listener lapses this long after the last poll. A poll holds at most 25s
 * and a failed one retries after 2s, so a producer that still asks always
 * refreshes it in time.
 */
const LISTENING_TTL_MS = 60 * 1000;
/** A closed session stays closed for the rest of the run. */
const CLOSED_TTL_MS = 24 * 60 * 60 * 1000;

interface ListenerLogContext {
  operationId: string;
  topicId: string;
}

const logFields = ({ operationId, topicId }: ListenerLogContext, listener?: HeteroSteerListener) =>
  `op=${operationId} topic=${topicId} cli=${listener?.cliVersion ?? 'unknown'}`;

const read = (operationId: string) =>
  redisService.steerQueue.getHeteroListener<HeteroSteerListener>(operationId);

const write = (operationId: string, listener: HeteroSteerListener) =>
  redisService.steerQueue.putHeteroListener(
    operationId,
    listener,
    listener.state === 'closed' ? CLOSED_TTL_MS : LISTENING_TTL_MS,
  );

/**
 * Tracks one `waitHeteroSteer` poll: refreshes the listener and reports, once
 * per change, which follow-up the run holds back. Every write is best-effort —
 * this only explains the queue, it never decides delivery.
 */
export class HeteroSteerPollTracker {
  private listener: HeteroSteerListener | undefined;

  private constructor(private readonly log: ListenerLogContext) {}

  /** Refresh the listener for a poll that just arrived. */
  static async start(
    log: ListenerLogContext,
    params: {
      acceptsAttachedImages?: boolean;
      acceptsImages?: boolean;
      agentId: string | null;
      cliVersion?: string;
    },
  ): Promise<HeteroSteerPollTracker> {
    const tracker = new HeteroSteerPollTracker(log);
    const previous = await read(log.operationId).catch(() => undefined);
    const listener: HeteroSteerListener = {
      ...params,
      // A hold outlives the poll that found it: the next poll holds the same one.
      hold: previous?.state === 'listening' ? previous.hold : undefined,
      polledAt: Date.now(),
      state: 'listening',
    };
    tracker.listener = listener;
    if (previous?.state !== 'listening')
      console.info('[steerQueue:hetero] run takes follow-ups %s', logFields(log, listener));
    await write(log.operationId, listener).catch(() => undefined);
    return tracker;
  }

  /** A follow-up waits for the run to end; logged and recorded when it changed. */
  async hold(hold: HeteroSteerHold): Promise<void> {
    const listener = this.listener;
    if (!listener) return;
    if (listener.hold?.entryId === hold.entryId && listener.hold.reason === hold.reason) return;

    listener.hold = hold;
    console.warn(
      '[steerQueue:hetero] follow-up %s waits for the run to end: %s %s',
      hold.entryId,
      hold.reason,
      logFields(this.log, listener),
    );
    await write(this.log.operationId, listener).catch(() => undefined);
  }

  /** The held follow-up left the queue head (delivered or withdrawn). */
  async release(): Promise<void> {
    const listener = this.listener;
    if (!listener?.hold) return;

    listener.hold = undefined;
    await write(this.log.operationId, listener).catch(() => undefined);
  }
}

/**
 * The session refused a delivered follow-up because its input closed: what is
 * still queued waits for the run to end.
 */
export const markHeteroSteerClosed = async (log: ListenerLogContext) => {
  const previous = await read(log.operationId).catch(() => undefined);
  console.warn('[steerQueue:hetero] session input closed %s', logFields(log, previous));
  await write(log.operationId, {
    agentId: previous?.agentId ?? null,
    cliVersion: previous?.cliVersion,
    polledAt: previous?.polledAt ?? Date.now(),
    state: 'closed',
  }).catch(() => undefined);
};

/**
 * The run follow-ups on the topic's main spine wait behind, when it is a
 * heterogeneous run: the topic's running marker, or one of its child runs.
 */
const heteroRunsOnSpine = (marker: NonNullable<RunningMarker>): string[] => {
  const runs = [marker, ...(marker.childOperations ?? [])].filter(
    (run) => !!run.heteroType && !run.threadId,
  );
  return runs.map((run) => run.operationId);
};

type RunningMarker = NonNullable<
  NonNullable<Awaited<ReturnType<TopicModel['findById']>>>['metadata']
>['runningOperation'];

export interface HeteroWaitReasons {
  /**
   * The running CLI run takes follow-ups into its live session: those without
   * a reason go in at its next read instead of waiting for the run to end.
   */
  listening: boolean;
  /** Why a follow-up waits for the running CLI run to end, by entry id. */
  reasons: Map<string, QueuedFollowUpWaitReason>;
}

/**
 * Why each waiting follow-up on a conversation waits for the running
 * heterogeneous run to end. Behind a built-in run (or on a thread) nothing is
 * given, since that run hands the turn back at its next step.
 *
 * Costs one topic read, a Redis read per hetero run on the spine and, when a
 * follow-up has attachments, one file read; the client asks only while it
 * shows queued follow-ups.
 */
export const resolveHeteroWaitReasons = async (
  ctx: { db: LobeChatDatabase; userId: string; workspaceId?: string | null },
  scope: SteerQueueScope,
  waiting: Pick<QueuedFollowUp, 'id' | 'request'>[],
): Promise<HeteroWaitReasons> => {
  const reasons = new Map<string, QueuedFollowUpWaitReason>();
  const none = { listening: false, reasons };
  if (waiting.length === 0 || scope.threadId) return none;

  const topic = await new TopicModel(ctx.db, ctx.userId, ctx.workspaceId ?? undefined).findById(
    scope.topicId,
  );
  const marker = topic?.metadata?.runningOperation;
  if (!marker) return none;
  const runs = heteroRunsOnSpine(marker);
  if (runs.length === 0) return none;

  let listener: HeteroSteerListener | undefined;
  for (const operationId of runs) {
    listener = await read(operationId).catch(() => undefined);
    if (listener) break;
  }

  if (!listener || listener.state === 'closed') {
    const reason = listener ? 'inputClosed' : 'notListening';
    for (const entry of waiting) reasons.set(entry.id, reason);
    return none;
  }

  const attachmentTypes = await loadAttachmentTypes(ctx, waiting);

  // The run takes the queue in order and stops at the first follow-up it
  // cannot take: everything behind that one waits too.
  let blocked = false;
  for (const entry of waiting) {
    // Read entries queued in the legacy selection shape the way delivery does.
    const request = foldLegacyUserMessageFields(entry.request);
    const reason = heteroSteerHoldReason({ request }, { ...listener, attachmentTypes });
    if (reason) {
      reasons.set(entry.id, reason);
      blocked = true;
    } else if (blocked) reasons.set(entry.id, 'behindHeld');
  }
  return { listening: true, reasons };
};
