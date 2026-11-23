import type { ChatTopic, UIChatMessage } from '@lobechat/types';

export const INTERVENTION_REFRESH_INTERVAL = 2000;

/** How long a pending card polls at the base interval before backing off. */
export const INTERVENTION_FAST_POLL_WINDOW = 5 * 60_000;
/** Ceiling of the backed-off poll interval. */
export const INTERVENTION_MAX_REFRESH_INTERVAL = 5 * 60_000;

/**
 * Poll interval after `elapsed` ms of continuous polling. An answer from
 * another device normally lands within minutes, so the first window keeps the
 * base interval; after that the interval doubles every minute up to the
 * ceiling. A question nobody answers keeps its run parked in
 * `waiting_for_human` for days, and without this backoff an open tab polled
 * every 2 s all that time.
 * Focus revalidation still refreshes immediately when the user returns.
 */
export const backoffPollInterval = (base: number, elapsed: number) => {
  if (base <= 0 || elapsed < INTERVENTION_FAST_POLL_WINDOW) return base;
  const doublings = 1 + Math.floor((elapsed - INTERVENTION_FAST_POLL_WINDOW) / 60_000);
  return Math.max(base, Math.min(base * 2 ** doublings, INTERVENTION_MAX_REFRESH_INTERVAL));
};

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

/** Ids of the persisted cards still waiting for an answer. */
export const pendingInterventionIds = (messages: UIChatMessage[]) =>
  messages
    .filter(
      (message) =>
        message.role === 'tool' &&
        !message.id.startsWith('tmp_') &&
        intervention(message)?.status === 'pending',
    )
    .map((message) => message.id);

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
