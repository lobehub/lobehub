import type { TopicModel } from '@/database/models/topic';

const INITIAL_RETRY_DELAY_MS = 100;
const MAX_RETRY_DELAY_MS = 1600;
const MAX_RESERVATION_ATTEMPTS = 6;

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Claim the gap between choosing a conversation parent and publishing the
 * operation's `runningOperation` marker. Every existing-topic start uses the
 * same claim, so a foreground message and a task callback cannot both observe
 * the topic as idle and create competing continuations.
 *
 * The bounded backoff deliberately throws instead of holding a workflow
 * request indefinitely; QStash retries callback deliveries on the resulting 500
 * response. Interactive sends pass `ignoreRunningOperation` so they contend
 * only for the short reservation and practically never reach that throw — a
 * busy failure there is indistinguishable from the message being swallowed,
 * since the gate runs before the user message is persisted.
 */
export const acquireTopicStartReservation = async ({
  allowRunningOperationId,
  allowSameReservationReentry,
  ignoreRunningOperation,
  replacesOperationId,
  reservationId,
  topicId,
  topicModel,
}: {
  allowRunningOperationId?: string;
  allowSameReservationReentry?: boolean;
  /**
   * Serialize only on the short reservation, not on `runningOperation`. Set by
   * interactive sends — see `TopicModel.tryReserveTaskCallback`.
   */
  ignoreRunningOperation?: boolean;
  replacesOperationId?: string;
  reservationId: string;
  topicId: string;
  topicModel: TopicModel;
}): Promise<boolean> => {
  for (let attempt = 0; attempt < MAX_RESERVATION_ATTEMPTS; attempt += 1) {
    const reservation = await topicModel.tryReserveTaskCallback(topicId, reservationId, {
      allowRunningOperationId,
      allowSameReservationReentry,
      ignoreRunningOperation,
      replacesOperationId,
    });

    if (reservation === null) return false;
    if (reservation) return true;

    if (attempt < MAX_RESERVATION_ATTEMPTS - 1) {
      const retryDelay = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
      await delay(retryDelay);
    }
  }

  throw new Error(`Topic ${topicId} remained busy while starting operation ${reservationId}`);
};
