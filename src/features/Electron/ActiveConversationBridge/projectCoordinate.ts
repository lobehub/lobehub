import { useAgentStore } from '@/store/agent';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';

import { type ActiveConversationCoordinate } from './coordinate';

export const projectActiveConversationCoordinate = (
  coordinate: ActiveConversationCoordinate,
): void => {
  const currentAgentId = useChatStore.getState().activeAgentId;

  if (coordinate.groupId) {
    const chatState = useChatStore.getState();
    const group = useAgentGroupStore.getState().groupMap[coordinate.groupId];
    const supervisorAgentId = group?.supervisorAgentId;
    const groupChanged = chatState.activeGroupId !== coordinate.groupId;

    if (useAgentGroupStore.getState().activeGroupId !== coordinate.groupId) {
      useAgentGroupStore.setState(
        { activeGroupId: coordinate.groupId },
        false,
        'ActiveConversationBridge/syncGroupRoute',
      );
    }

    if (
      supervisorAgentId !== undefined &&
      useAgentStore.getState().activeAgentId !== supervisorAgentId
    ) {
      useAgentStore.setState(
        { activeAgentId: supervisorAgentId },
        false,
        'ActiveConversationBridge/syncGroupSupervisor',
      );
    }
    if (
      chatState.activeGroupId !== coordinate.groupId ||
      (supervisorAgentId !== undefined && chatState.activeAgentId !== supervisorAgentId) ||
      ((coordinate.isConversation || groupChanged) &&
        (chatState.activeTopicId !== coordinate.topicId ||
          chatState.activeThreadId !== coordinate.threadId))
    ) {
      useChatStore.setState(
        {
          activeGroupId: coordinate.groupId,
          ...(supervisorAgentId !== undefined ? { activeAgentId: supervisorAgentId } : {}),
          ...(coordinate.isConversation
            ? { activeThreadId: coordinate.threadId!, activeTopicId: coordinate.topicId! }
            : groupChanged
              ? { activeThreadId: undefined, activeTopicId: null! }
            : {}),
        },
        false,
        'ActiveConversationBridge/syncGroupRoute',
      );
    }
    return;
  }

  if (useAgentGroupStore.getState().activeGroupId !== undefined) {
    useAgentGroupStore.setState(
      { activeGroupId: undefined, router: undefined },
      false,
      'ActiveConversationBridge/leaveGroup',
    );
  }

  if (!coordinate.routeAgentId) {
    if (useAgentStore.getState().activeAgentId !== undefined) {
      useAgentStore.setState(
        { activeAgentId: undefined },
        false,
        'ActiveConversationBridge/leaveAgent',
      );
    }
    if (
      currentAgentId !== undefined ||
      useChatStore.getState().activeGroupId !== undefined ||
      useChatStore.getState().activeTopicId !== undefined
    ) {
      useChatStore.setState(
        {
          activeAgentId: undefined,
          activeGroupId: undefined,
          activeThreadId: undefined,
          activeTopicId: undefined,
        },
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
  const leavingGroup = chatState.activeGroupId !== undefined;

  if (coordinate.isConversation) {
    if (
      chatState.activeAgentId !== agentId ||
      leavingGroup ||
      chatState.activeTopicId !== coordinate.topicId ||
      chatState.activeThreadId !== coordinate.threadId
    ) {
      useChatStore.setState(
        {
          activeAgentId: agentId,
          activeGroupId: undefined,
          activeThreadId: coordinate.threadId!,
          activeTopicId: coordinate.topicId!,
        },
        false,
        'ActiveConversationBridge/syncConversation',
      );
    }
    return;
  }

  const agentContextChanged = chatState.activeAgentId !== agentId || leavingGroup || agentChanged;

  if (agentContextChanged) {
    useChatStore.setState(
      {
        activeAgentId: agentId,
        activeGroupId: undefined,
        activeThreadId: undefined,
        activeTopicId: null!,
      },
      false,
      'ActiveConversationBridge/syncAgent',
    );
  }
};
