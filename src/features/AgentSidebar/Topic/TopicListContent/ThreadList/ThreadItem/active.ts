/**
 * Whether a thread row reads as "current".
 *
 * A row opens its thread in the Portal instead of switching the conversation,
 * so the Portal's thread is the row's current state; `activeThreadId` is only
 * the fallback for when the Portal shows no thread. OR-ing the two marked two
 * rows active at once whenever the conversation and the Portal were on
 * different threads.
 */
export const isThreadRowActive = ({
  activeThreadId,
  portalThreadId,
  threadId,
}: {
  activeThreadId?: null | string;
  portalThreadId?: null | string;
  threadId: string;
}): boolean => (portalThreadId ? threadId === portalThreadId : threadId === activeThreadId);
