import { isDesktop } from '@lobechat/const';
import { toast } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { useCommitWorkingDirectory } from '@/features/ChatInput/ControlBar/useCommitWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

interface UseStartTopicInDirectoryParams {
  /**
   * The agent of the conversation that rendered the reference. The action is
   * only offered when it is also the active main-agent conversation: the global
   * `activeAgentId` can point at another agent (e.g. a task agent while a group
   * chat is shown), and `switchTopic` acts on the active conversation only.
   */
  conversationAgentId?: string;
  isDirectory: boolean;
  path?: string;
  readonly: boolean;
}

export const useStartTopicInDirectory = ({
  conversationAgentId,
  isDirectory,
  path,
  readonly,
}: UseStartTopicInDirectoryParams) => {
  const { t } = useTranslation('components');
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const isActiveConversation = !!conversationAgentId && conversationAgentId === activeAgentId;
  const { commitAgentDefault, isPreferenceLoading } = useCommitWorkingDirectory(
    conversationAgentId ?? '',
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
