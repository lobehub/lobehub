import { toast } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommitWorkingDirectory } from '@/features/ChatInput/ControlBar/useCommitWorkingDirectory';
import HeterogeneousAgentStatusGuide from '@/features/Electron/HeterogeneousAgent/StatusGuide';
import type {
  HeterogeneousAgentStatusGuideProps,
  HeterogeneousAgentWorkingDirectoryResetState,
} from '@/features/Electron/HeterogeneousAgent/StatusGuide/types';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { getMissingWorkingDirectory, resolveStaleWorktreeReset } from './staleWorktreeReset';

interface WorkingDirectoryStatusGuideProps extends HeterogeneousAgentStatusGuideProps {
  agentId: string;
  topicId: string;
}

/**
 * The "working directory not found" guide, plus a way back when the missing
 * directory is a deleted worktree. Mounted only for that error so the
 * working-directory hooks don't run under every error card.
 */
const WorkingDirectoryStatusGuide = memo<WorkingDirectoryStatusGuideProps>(
  ({ agentId, topicId, ...props }) => {
    const { t } = useTranslation('chat');
    const config = useChatStore(
      (s) => topicSelectors.getTopicById(topicId)(s)?.metadata?.workingDirectoryConfig,
    );
    // Same funnel as the control bar's stale-snapshot reset and worktree
    // dropdown, so the topic write (and its project-root guard) can't drift.
    const { commit } = useCommitWorkingDirectory(agentId, topicId);

    const reset = resolveStaleWorktreeReset(config, getMissingWorkingDirectory(props.error));
    const { onRetry } = props;

    const workingDirectoryReset: HeterogeneousAgentWorkingDirectoryResetState | undefined =
      reset && onRetry
        ? {
            name: reset.name,
            onReset: async () => {
              try {
                await commit(reset.entry);
              } catch (error) {
                console.error('[WorkingDirectoryStatusGuide] Failed to reset worktree:', error);
                toast.error(t('workingDirectoryGuide.resetFailed'));
                return;
              }
              onRetry();
            },
          }
        : undefined;

    return (
      <HeterogeneousAgentStatusGuide {...props} workingDirectoryReset={workingDirectoryReset} />
    );
  },
);

WorkingDirectoryStatusGuide.displayName = 'WorkingDirectoryStatusGuide';

export default WorkingDirectoryStatusGuide;
