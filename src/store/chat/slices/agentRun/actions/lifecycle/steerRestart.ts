import type { ConversationContext } from '@lobechat/types';

import type { ChatStore } from '@/store/chat/store';

import { getRestartUnsteerableRun } from './followUpMode';
import { isWaitingQueuedMessage, sendQueuedMessagesNow } from './sendQueuedNow';

export interface SteerRestartOptions {
  context: ConversationContext;
  /** Queue key the run's follow-ups wait under. */
  contextKey: string;
  get: () => ChatStore;
  operationId: string;
  /** Called on every store change that may matter: the queue or the operation. */
  subscribe: (listener: () => void) => () => void;
}

/** Conversations with a restart on its way: a follow-up meanwhile joins it. */
const restarting = new Set<string>();
/** Runs already watched: `stream_start` repeats every step. */
const watched = new Set<string>();

/**
 * Follow-up behavior Steer, with "restart agents that can't steer" on: a run
 * known to take no messages mid-run (`steerUnsupported`) is stopped as soon as
 * a follow-up waits behind it, and every waiting follow-up starts the next turn
 * as one message — the same stop-and-send as the tray's Send now.
 *
 * Only a run known to be unable to steer is stopped: one whose ability is
 * still unknown (a gateway run before its producer reported) keeps its queue.
 * A follow-up queued while the run is stopping joins the same restart. The
 * watch ends with the run.
 */
export const createSteerRestart = ({
  context,
  contextKey,
  get,
  operationId,
  subscribe,
}: SteerRestartOptions) => {
  let unsubscribe: (() => void) | undefined;
  let ended = false;

  const stop = () => {
    ended = true;
    watched.delete(operationId);
    unsubscribe?.();
    unsubscribe = undefined;
  };

  const check = () => {
    if (ended) return;
    const operation = get().operations[operationId];
    if (operation?.status !== 'running') return stop();
    if (!operation.metadata.steerUnsupported || !getRestartUnsteerableRun()) return;
    if (restarting.has(contextKey)) return;

    const waiting = (get().queuedMessages[contextKey] ?? []).filter(isWaitingQueuedMessage);
    if (waiting.length === 0) return;

    restarting.add(contextKey);
    sendQueuedMessagesNow({
      context,
      contextKey,
      getChat: get,
      msgs: waiting,
      takeArrivals: true,
      withdraw: (msg) => get().withdrawQueuedMessage(contextKey, msg.id),
    })
      // What was taken is back in the queue; it goes when the run ends.
      .catch((error) => console.error('[steerRestart] restarting the run failed:', error))
      .finally(() => restarting.delete(contextKey));
  };

  watched.add(operationId);
  unsubscribe = subscribe(check);
  check();
  // The run may have ended during the first check.
  if (ended) unsubscribe?.();
  return { stop };
};

/**
 * Watch a run just found unable to steer, unless it is watched already.
 * Imported lazily by transports that must not load the chat store eagerly.
 */
export const watchSteerRestart = async (
  options: Omit<SteerRestartOptions, 'contextKey' | 'subscribe'> & { contextKey?: string },
) => {
  if (watched.has(options.operationId)) return;
  const [{ useChatStore }, { messageMapKey }] = await Promise.all([
    import('@/store/chat/store'),
    import('@/store/chat/utils/messageMapKey'),
  ]);
  if (watched.has(options.operationId)) return;
  const contextKey = options.contextKey ?? messageMapKey(options.context);
  createSteerRestart({
    ...options,
    contextKey,
    subscribe: (listener) =>
      useChatStore.subscribe((state, prev) => {
        if (
          state.queuedMessages[contextKey] !== prev.queuedMessages[contextKey] ||
          state.operations[options.operationId] !== prev.operations[options.operationId]
        )
          listener();
      }),
  });
};
