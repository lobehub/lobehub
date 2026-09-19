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
  const { commitAgentDefault } = useCommitWorkingDirectory(activeAgentId ?? '');
  const switchTopic = useChatStore((s) => s.switchTopic);
  const canStartTopic = isDesktop && isDirectory && !readonly && !!path && !!activeAgentId;

  const startTopic = async () => {
    if (!path || !activeAgentId) return;

    try {
      await commitAgentDefault(path);
      await switchTopic(null, { skipRefreshMessage: true });
    } catch {
      toast.error(t('LocalFile.action.startTopicFailed'));
    }
  };

  return { canStartTopic, startTopic };
};
