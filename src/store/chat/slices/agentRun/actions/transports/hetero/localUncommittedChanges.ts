import type { WorkingDirConfig } from '@lobechat/types';

import {
  readUncommittedChanges,
  shouldCheckUncommittedChanges,
} from '@/helpers/uncommittedChanges';
import { gitService } from '@/services/git';
import { topicSelectors } from '@/store/chat/selectors';
import type { ChatStore } from '@/store/chat/store';

/**
 * Someone's uncommitted work in the directory a CLI spawned on this desktop
 * starts in — the same check the server makes before a device dispatch
 * (`heteroDispatch/device`), for a project conversation in the agent's own
 * working directory, on a fresh CLI session.
 */
export const readLocalUncommittedChanges = async (
  state: ChatStore,
  {
    context,
    resumeSessionId,
    workingDirectoryConfig,
  }: {
    context: { topicId?: string | null };
    resumeSessionId?: string;
    workingDirectoryConfig?: WorkingDirConfig;
  },
) => {
  // A resumed session already holds the hint; what it finds now is its own work.
  if (resumeSessionId) return;
  const topic = context.topicId ? topicSelectors.getTopicById(context.topicId)(state) : undefined;
  // The topic's current config, as the run records it: a worktree it moved into lands there.
  const cwdConfig = topic?.metadata?.workingDirectoryConfig ?? workingDirectoryConfig;
  if (!cwdConfig?.path || !shouldCheckUncommittedChanges({ cwdConfig, topic })) return;
  const { path } = cwdConfig;
  return readUncommittedChanges(
    {
      branch: () => gitService.getGitBranch({ path }),
      status: () => gitService.getGitWorkingTreeStatus({ path }),
    },
    path,
  );
};
