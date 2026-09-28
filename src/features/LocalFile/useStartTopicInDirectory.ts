import { isDesktop } from '@lobechat/const';
import { toast } from '@lobehub/ui/base-ui';
import { use } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommitWorkingDirectory } from '@/features/ChatInput/ControlBar/useCommitWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

import {
  type StartTopicConversation,
  StartTopicConversationContext,
} from './StartTopicConversation';

interface UseStartTopicInDirectoryParams {
  /**
   * The conversation that rendered the reference (falls back to
   * `StartTopicConversationContext`). The action is only offered
   * while it is the active main conversation (same agent and topic): the global
   * `activeAgentId` can point at another agent (e.g. a task agent while a group
   * chat is shown), and `switchTopic` acts on the active conversation only.
   */
  conversation?: StartTopicConversation;
  isDirectory: boolean;
  path?: string;
  readonly: boolean;
}

export const useStartTopicInDirectory = ({
  conversation: conversationProp,
  isDirectory,
  path,
  readonly,
}: UseStartTopicInDirectoryParams) => {
  const { t } = useTranslation('components');
  // Rich-text folder chips render headlessly and cannot receive props, so they
  // pick the conversation up from context instead.
  const conversationFromContext = use(StartTopicConversationContext);
  const conversation = conversationProp ?? conversationFromContext;
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const activeTopicId = useChatStore((s) => s.activeTopicId ?? null);
  const isActiveConversation =
    !!conversation &&
    conversation.agentId === activeAgentId &&
    conversation.topicId === activeTopicId;
  // `null` topic: resolve the device the FRESH topic will run on (the agent's
  // default target), not the current topic's pinned machine — otherwise the
  // directory lands under a device the new topic never reads.
  const { commitAgentDefault, isPreferenceLoading } = useCommitWorkingDirectory(
    conversation?.agentId ?? '',
    null,
  );
  const switchTopic = useChatStore((s) => s.switchTopic);
  // Wait for a workspace agent's preference fetch: until it settles the write
  // may route to the workspace-shared device instead of this member's own slot.
  const canStartTopic =
    isDesktop && isDirectory && !readonly && !!path && isActiveConversation && !isPreferenceLoading;

  const startTopic = async () => {
    if (!canStartTopic || !path) return;

    // Capture where the click came from: the save can be slow, and the user may
    // move to another agent/topic meanwhile — clearing that selection would
    // discard what they navigated to.
    const originAgentId = useAgentStore.getState().activeAgentId;
    const originTopicId = useChatStore.getState().activeTopicId;

    try {
      // Rethrow so a failed save keeps the user on the current topic instead of
      // opening a fresh one without the chosen directory; the toast below
      // replaces the store's generic save-failure message.
      await commitAgentDefault(path, { rethrow: true, showErrorMessage: false });

      const stillOnOrigin =
        useAgentStore.getState().activeAgentId === originAgentId &&
        useChatStore.getState().activeTopicId === originTopicId;
      if (!stillOnOrigin) return;

      await switchTopic(null, { skipRefreshMessage: true });
    } catch {
      toast.error(t('LocalFile.action.startTopicFailed'));
    }
  };

  return { canStartTopic, startTopic };
};
