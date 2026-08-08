import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

import { type ActiveConversationCoordinate } from './coordinate';

export const projectActiveConversationCoordinate = (
  coordinate: ActiveConversationCoordinate,
): void => {
  const currentAgentId = useChatStore.getState().activeAgentId;

  if (!coordinate.routeAgentId) {
    if (useAgentStore.getState().activeAgentId !== undefined) {
      useAgentStore.setState(
        { activeAgentId: undefined },
        false,
        'ActiveConversationBridge/leaveAgent',
      );
    }
    if (currentAgentId !== undefined || useChatStore.getState().activeTopicId !== undefined) {
      useChatStore.setState(
        { activeAgentId: undefined, activeTopicId: undefined },
        false,
        'ActiveConversationBridge/leaveAgent',
      );
    }
    return;
  }

  const agentId = coordinate.agentId || coordinate.routeAgentId;
  const agentChanged = currentAgentId !== undefined && currentAgentId !== agentId;

  if (agentChanged) useChatStore.getState().clearPortalStack();

  if (useAgentStore.getState().activeAgentId !== agentId) {
    useAgentStore.setState({ activeAgentId: agentId }, false, 'ActiveConversationBridge/syncAgent');
  }

  const chatState = useChatStore.getState();

  if (coordinate.isConversation) {
    if (
      chatState.activeAgentId !== agentId ||
      chatState.activeTopicId !== coordinate.topicId ||
      chatState.activeThreadId !== coordinate.threadId
    ) {
      useChatStore.setState(
        {
          activeAgentId: agentId,
          activeThreadId: coordinate.threadId!,
          activeTopicId: coordinate.topicId!,
        },
        false,
        'ActiveConversationBridge/syncConversation',
      );
    }
    return;
  }

  if (chatState.activeAgentId !== agentId || agentChanged) {
    useChatStore.setState(
      {
        activeAgentId: agentId,
        ...(agentChanged ? { activeThreadId: undefined, activeTopicId: null! } : {}),
      },
      false,
      'ActiveConversationBridge/syncAgent',
    );
  }
};
