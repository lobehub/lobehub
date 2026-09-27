import { isDesktop } from '@lobechat/const';
import { toast } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { useCommitWorkingDirectory } from '@/features/ChatInput/ControlBar/useCommitWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

interface UseStartTopicInDirectoryParams {
  isDirectory: boolean;
  path?: string;
  readonly: boolean;
}

export const useStartTopicInDirectory = ({
  isDirectory,
  path,
  readonly,
}: UseStartTopicInDirectoryParams) => {
  const { t } = useTranslation('components');
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const { commitAgentDefault, isPreferenceLoading } = useCommitWorkingDirectory(
    activeAgentId ?? '',
  );
  const switchTopic = useChatStore((s) => s.switchTopic);
  // Wait for a workspace agent's preference fetch: until it settles the write
  // may route to the workspace-shared device instead of this member's own slot.
  const canStartTopic =
    isDesktop && isDirectory && !readonly && !!path && !!activeAgentId && !isPreferenceLoading;

  const startTopic = async () => {
    if (!canStartTopic || !path) return;

    try {
      // Rethrow so a failed save keeps the user on the current topic instead of
      // opening a fresh one without the chosen directory; the toast below
      // replaces the store's generic save-failure message.
      await commitAgentDefault(path, { rethrow: true, showErrorMessage: false });
      await switchTopic(null, { skipRefreshMessage: true });
    } catch {
      toast.error(t('LocalFile.action.startTopicFailed'));
    }
  };

  return { canStartTopic, startTopic };
};
