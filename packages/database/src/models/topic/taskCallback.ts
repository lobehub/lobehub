import type { ChatTopicMetadata } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { topics } from '../../schemas';
import type { TopicModelContext } from './context';
import { isRunningOperationAlive } from './runningOperation';

export const TASK_CALLBACK_RESERVATION_TTL_MS = 5 * 60 * 1000;

/**
 * Whether a turn start currently holds the topic's short start reservation.
 * A writer that changes where the topic runs must respect it as it would a
 * `runningOperation`: the reserving turn may already have resolved its target.
 */
export const hasLiveTaskCallbackReservation = (
  metadata: Pick<ChatTopicMetadata, 'taskCallbackReservation'> | null | undefined,
  now = Date.now(),
): boolean => {
  const reservation = metadata?.taskCallbackReservation;
  if (!reservation) return false;
  const reservedAt = Date.parse(reservation.reservedAt);
  return Number.isFinite(reservedAt) && now - reservedAt < TASK_CALLBACK_RESERVATION_TTL_MS;
};

/**
 * Atomically reserve an idle topic for one task-callback delivery.
 *
 * The topic row lock closes the check/set race between callback workers:
 * only one callback can observe both `runningOperation` and the reservation
 * as empty. Foreground/tool continuations clear `runningOperation` before a
 * callback can claim the topic, so the callback always re-anchors on the
 * completed turn's latest spine.
 */
export const tryReserveTaskCallback = async (
  ctx: TopicModelContext,
  id: string,
  messageId: string,
  options?: {
    /**
     * Permit a start that runs *under* this marker (a group member starting
     * beneath its supervisor). A pure permission check — it never takes the
     * reservation.
     */
    allowRunningOperationId?: string;
    /**
     * A deterministic intervention reservation is an initializer fence, not
     * a reentrant mutex. Its concurrent same-id caller must wait until the
     * owner releases (or the lease expires) instead of entering preparation
     * and overwriting an already-running continuation state.
     */
    allowSameReservationReentry?: boolean;
    /**
     * Skip the `runningOperation` check entirely and serialize only on the
     * short reservation. Set by interactive sends: "don't run two foreground
     * turns at once" is a UX policy the client already owns end to end (queue
     * tray, "Send now", FIFO drain), and it is the only layer that can show
     * the user anything. A second, blind copy of that policy here can only
     * fail worse — it used to destroy the message before it was ever
     * persisted. Background starts (task callbacks, cron, bots) have no such
     * queue and keep the check.
     */
    ignoreRunningOperation?: boolean;
    replacesOperationId?: string;
  },
): Promise<boolean | null> =>
  ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(and(eq(topics.id, id), ctx.ownership()))
      .for('update');

    if (!existing) return null;

    const reservation = existing.metadata?.taskCallbackReservation;
    const hasLiveReservation = hasLiveTaskCallbackReservation(existing.metadata);

    if (
      reservation?.messageId === messageId &&
      hasLiveReservation &&
      options?.allowSameReservationReentry !== false
    ) {
      return true;
    }

    const runningOperation = existing.metadata?.runningOperation;
    const ownedRunningOperation =
      !!options?.allowRunningOperationId &&
      runningOperation?.operationId === options.allowRunningOperationId;
    if (options?.allowRunningOperationId) return ownedRunningOperation;

    const canReplaceRunningOperation =
      !!options?.replacesOperationId &&
      runningOperation?.operationId === options.replacesOperationId;

    // Only a run that can prove it is still alive may hold the topic. Ask the
    // operation row rather than the marker's age: the marker is never
    // refreshed, so age alone declares a legitimately long run (an approval
    // wait can last days) dead and lets a competing continuation start.
    const hasLiveRunningOperation =
      !!runningOperation &&
      !canReplaceRunningOperation &&
      !options?.ignoreRunningOperation &&
      (await isRunningOperationAlive(ctx, tx, runningOperation));

    if (hasLiveRunningOperation || hasLiveReservation) return false;

    await tx
      .update(topics)
      .set({
        metadata: {
          ...existing.metadata,
          ...(canReplaceRunningOperation && { runningOperation: null }),
          taskCallbackReservation: {
            messageId,
            reservedAt: new Date().toISOString(),
          },
        },
      })
      .where(and(eq(topics.id, id), ctx.ownership()));

    return true;
  });

/**
 * Repair the reconnect anchor after an intervention queue ACK. The same row
 * lock also releases only this continuation's reservation, closing the crash
 * window between provider ACK and execAgent's ordinary running-marker write.
 */
export const repairAgentInterventionContinuation = async (
  ctx: TopicModelContext,
  params: {
    active: boolean;
    assistantMessageId: string;
    continuationOperationId: string;
    reservationId: string;
    scope?: string | null;
    sourceOperationId: string;
    startedAt: string;
    threadId?: string | null;
    topicId: string;
  },
): Promise<'conflict' | 'repaired' | 'terminal'> =>
  ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(and(eq(topics.id, params.topicId), ctx.ownership()))
      .for('update');
    if (!existing) return 'conflict';

    const current = existing.metadata?.runningOperation;
    const reservation = existing.metadata?.taskCallbackReservation;
    const hasLiveReservation = hasLiveTaskCallbackReservation(existing.metadata);
    const ownsCurrent =
      !current ||
      current.operationId === params.sourceOperationId ||
      current.operationId === params.continuationOperationId;
    const ownsReservation = reservation?.messageId === params.reservationId;
    if (hasLiveReservation && !ownsReservation) return 'conflict';
    if (!ownsCurrent) {
      if (ownsReservation) {
        await tx
          .update(topics)
          .set({
            metadata: { ...existing.metadata, taskCallbackReservation: null },
            updatedAt: new Date(),
          })
          .where(and(eq(topics.id, params.topicId), ctx.ownership()));
      }
      return 'conflict';
    }

    const runningOperation = params.active
      ? {
          ...(current?.operationId === params.continuationOperationId ? current : {}),
          assistantMessageId: params.assistantMessageId,
          heteroType: null,
          operationId: params.continuationOperationId,
          scope: params.scope ?? undefined,
          startedAt: params.startedAt,
          threadId: params.threadId ?? undefined,
        }
      : null;
    await tx
      .update(topics)
      .set({
        metadata: {
          ...existing.metadata,
          runningOperation,
          /* v8 ignore start -- unreachable: the `{}` arm; a live reservation this caller does not own already returned 'conflict' above */
          ...(ownsReservation || !hasLiveReservation ? { taskCallbackReservation: null } : {}),
          /* v8 ignore stop */
        },
        updatedAt: new Date(),
      })
      .where(and(eq(topics.id, params.topicId), ctx.ownership()));

    return params.active ? 'repaired' : 'terminal';
  });

/**
 * Release only the caller's reservation. The ownership check prevents a
 * delayed finally block from clearing a newer callback's claim.
 */
export const releaseTaskCallbackReservation = async (
  ctx: TopicModelContext,
  id: string,
  messageId: string,
): Promise<'absent' | 'foreign' | 'released'> =>
  ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(and(eq(topics.id, id), ctx.ownership()))
      .for('update');

    const reservation = existing?.metadata?.taskCallbackReservation;
    if (!reservation) return 'absent';
    if (reservation.messageId !== messageId) return 'foreign';

    await tx
      .update(topics)
      .set({
        metadata: {
          ...existing.metadata,
          taskCallbackReservation: null,
        },
      })
      .where(and(eq(topics.id, id), ctx.ownership()));
    return 'released';
  });
