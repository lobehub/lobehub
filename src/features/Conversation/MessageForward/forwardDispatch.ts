export { buildForwardedContent } from '@/store/chat/slices/forward/helpers';

/**
 * A forward request parked in {@link useForwardDispatchStore} while we navigate
 * to the target agent. Mirrors the screen-capture overlay-dispatch pattern: the
 * payload can't ride a URL query param (a multi-message transcript is too big),
 * so we stash it in a store and let a consumer mounted in the target agent's
 * conversation drain it once that conversation is ready.
 */
export interface PendingForwardDispatch {
  /** Already-formatted transcript that becomes the forwarded user message. */
  content: string;
  /** Distinguishes successive forwards so a stale consume can't fire twice. */
  dispatchId: string;
  /** How many messages the transcript was built from (for UX feedback). */
  messageCount: number;
  /** Agent the transcript is being forwarded to. */
  targetAgentId: string;
}

interface CanConsumePendingForwardParams {
  agentId?: string | null;
  isAgentConfigLoading: boolean;
  pendingForward: PendingForwardDispatch | null;
  routeAgentId?: string | null;
  topicId?: string | null;
}

/**
 * Gate a pending forward against the conversation that's currently mounted, so
 * we only send once the *target* agent's fresh conversation is the active one.
 * Same guards as `canConsumePendingOverlayDispatch`.
 */
export const canConsumePendingForward = ({
  agentId,
  isAgentConfigLoading,
  pendingForward,
  routeAgentId,
  topicId,
}: CanConsumePendingForwardParams) => {
  if (!pendingForward || !agentId) return false;
  if (pendingForward.targetAgentId !== agentId) return false;
  if (routeAgentId && routeAgentId !== agentId) return false;

  // A forward always opens a brand-new topic on the target agent, so the topic
  // must be unset. If it isn't yet (navigation still settling) we wait.
  const isNewConversation = !topicId;

  return !isAgentConfigLoading && isNewConversation;
};
