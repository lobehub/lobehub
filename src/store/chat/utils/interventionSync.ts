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
    local.tool_call_id !== incoming.tool_call_id ||
    previous?.operationId !== next?.operationId ||
    previous?.batchId !== next?.batchId
  )
    return;

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
