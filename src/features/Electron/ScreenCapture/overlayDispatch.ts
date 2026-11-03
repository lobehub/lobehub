export interface PendingOverlayDispatch {
  agentId: string;
  captureIds: string[];
  dispatchId: string;
  modelId?: string;
  prompt: string;
  provider?: string;
}

interface CanConsumePendingOverlayDispatchParams {
  agentId?: string | null;
  isAgentConfigLoading: boolean;
  messagesInit: boolean;
  pendingDispatch: PendingOverlayDispatch | null;
  routeAgentId?: string | null;
  topicId?: string | null;
}

export const canConsumePendingOverlayDispatch = ({
  agentId,
  isAgentConfigLoading,
  messagesInit,
  pendingDispatch,
  routeAgentId,
  topicId,
}: CanConsumePendingOverlayDispatchParams) => {
  if (!pendingDispatch || !agentId) return false;
  if (pendingDispatch.agentId !== agentId) return false;
  if (routeAgentId && routeAgentId !== agentId) return false;

  const isNewConversation = !topicId;

  return !isAgentConfigLoading && (isNewConversation || messagesInit);
};
