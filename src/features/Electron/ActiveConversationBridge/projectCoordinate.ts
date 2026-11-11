import { useAgentStore } from '@/store/agent';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { type ActiveConversationCoordinate } from './coordinate';

const resolveProjectTopicAgentId = (
  projectId: string,
  topicId: string | null,
): string | undefined => {
  if (!topicId) return undefined;

  const projectTopics = useProjectDirectoryStore.getState().projectTopicsMap[projectId];
  const agentId = projectTopics?.find((topic) => topic.id === topicId)?.agentId;
  if (agentId) return agentId;

  // The project topic list can still be hydrating; fall back to whichever chat
  // topic bucket already holds this topic (`agent_<agentId>` keys).
  const containerKey = topicSelectors.getTopicContainerKeyById(topicId)(useChatStore.getState());
  return containerKey?.startsWith('agent_') ? containerKey.slice('agent_'.length) : undefined;
};

interface ProjectActiveConversationOptions {
  /** Agent the home page scopes the shell to; undefined until builtin agents load. */
  inboxAgentId?: string;
}

export const projectActiveConversationCoordinate = (
  coordinate: ActiveConversationCoordinate,
  { inboxAgentId }: ProjectActiveConversationOptions = {},
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

  if (coordinate.projectId) {
    const chatState = useChatStore.getState();
    const agentId = resolveProjectTopicAgentId(coordinate.projectId, coordinate.topicId);

    if (agentId !== undefined && useAgentStore.getState().activeAgentId !== agentId) {
      useAgentStore.setState(
        { activeAgentId: agentId },
        false,
        'ActiveConversationBridge/syncProjectAgent',
      );
    }

    const agentChanged = agentId !== undefined && chatState.activeAgentId !== agentId;
    const agentSwitched =
      agentId !== undefined && currentAgentId !== undefined && currentAgentId !== agentId;

    if (agentSwitched) useChatStore.getState().clearPortalStack();

    if (
      agentChanged ||
      chatState.activeGroupId !== undefined ||
      chatState.activeThreadId !== coordinate.threadId ||
      chatState.activeTopicId !== coordinate.topicId
    ) {
      useChatStore.setState(
        {
          ...(agentId !== undefined ? { activeAgentId: agentId } : {}),
          activeGroupId: undefined,
          activeThreadId: coordinate.threadId!,
          activeTopicId: coordinate.topicId!,
        },
        false,
        'ActiveConversationBridge/syncProjectConversation',
      );
    }
    return;
  }

  if (!coordinate.routeAgentId) {
    // The home page scopes the agent store to the inbox agent. On desktop this
    // bridge owns that write instead of the home layout: keep-alive tabs run the
    // home layout's effects whenever its <Activity> shows or hides, and that
    // commit is deferred behind the tab switch, so a home-owned write landed
    // after this projection and left another tab's sidebar on the inbox agent
    // (or on no agent).
    const homeAgentId = coordinate.isHome ? inboxAgentId : undefined;
    if (useAgentStore.getState().activeAgentId !== homeAgentId) {
      useAgentStore.setState(
        { activeAgentId: homeAgentId },
        false,
        homeAgentId
          ? 'ActiveConversationBridge/syncHomeAgent'
          : 'ActiveConversationBridge/leaveAgent',
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
