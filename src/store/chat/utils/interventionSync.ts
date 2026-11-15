import type { ChatTopic, UIChatMessage } from '@lobechat/types';

export const INTERVENTION_REFRESH_INTERVAL = 2000;

/** A missing operation marker can still mean the continuation is starting. */
export const isInterventionRunActive = (topic: ChatTopic | null) =>
  !!topic?.metadata?.runningOperation ||
  !!topic?.metadata?.taskCallbackReservation ||
  topic?.status === 'running' ||
  topic?.status === 'waitingForHuman';

const intervention = (message: UIChatMessage) =>
  message.pluginIntervention ?? message.plugin?.intervention;

export const hasPendingInterventions = (messages: UIChatMessage[]) =>
  messages.some(
    (message) =>
      message.role === 'tool' &&
      !message.id.startsWith('tmp_') &&
      intervention(message)?.status === 'pending',
  );

const isTerminal = (status: string | undefined) =>
  status === 'approved' || status === 'rejected' || status === 'aborted';

/**
 * A server row that names a different operation or batch belongs to another
 * request on the same tool call and must not settle this one.
 */
const isSameRequest = (
  previous: ReturnType<typeof intervention>,
  next: ReturnType<typeof intervention>,
) => previous?.operationId === next?.operationId && previous?.batchId === next?.batchId;

/**
 * A terminal row with no request identity is still the server's answer for
 * this tool call: the producer's ACK write replaces the whole intervention with
 * `{ status, rejectedReason }`, dropping the operationId/batchId the pending
 * card carries. A tool message is never re-raised after a terminal state
 * (`reduceInterventionRequest` keeps the earlier terminal), so such a row
 * cannot belong to a newer request than the local pending one.
 */
const isUnscopedTerminal = (next: ReturnType<typeof intervention>) =>
  isTerminal(next?.status) && !next?.operationId && !next?.batchId;

/** Plugin rows can change without advancing the parent message's updatedAt. */
export const reconcileIntervention = (
  local: UIChatMessage,
  incoming: UIChatMessage,
): UIChatMessage | undefined => {
  const previous = intervention(local);
  const next = intervention(incoming);
  if (
    local.role !== 'tool' ||
    incoming.role !== 'tool' ||
    local.id !== incoming.id ||
    local.tool_call_id !== incoming.tool_call_id
  )
    return;

  // Without this, the head merge falls back to updatedAt, where the card's
  // client-clock timestamp can beat the server row and keep the answered card
  // pending, even across reloads, because the stale row is persisted.
  if (previous?.status === 'pending' && isUnscopedTerminal(next)) return incoming;
  if (!isSameRequest(previous, next)) return;

  if (previous?.status === 'pending' && isTerminal(next?.status)) return incoming;
  // Continuation startup can fail and restore this request to pending.
  if (
    isTerminal(previous?.status) &&
    next?.status === 'pending' &&
    incoming.updatedAt > local.updatedAt
  )
    return incoming;
};

/** Apply remote answers while leaving the locally streaming transcript intact. */
export const reconcileStreamingInterventions = (
  local: UIChatMessage[],
  incoming: UIChatMessage[],
) => {
  const incomingById = new Map(incoming.map((message) => [message.id, message]));
  let changed = false;
  const merged = local.map((message) => {
    const fetched = incomingById.get(message.id);
    incomingById.delete(message.id);
    const resolved = fetched && reconcileIntervention(message, fetched);
    if (!resolved) return message;
    changed = true;
    return resolved;
  });
  // A parked run can discover new member/tool rows while older rows stream.
  if (incomingById.size > 0) return [...merged, ...incomingById.values()];
  return changed ? merged : local;
};
