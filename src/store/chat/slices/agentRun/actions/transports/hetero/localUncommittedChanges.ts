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
 * working directory.
 */
export const readLocalUncommittedChanges = async (
  state: ChatStore,
  context: { topicId?: string | null },
  cwdConfig: WorkingDirConfig | undefined,
) => {
  const topic = context.topicId ? topicSelectors.getTopicById(context.topicId)(state) : undefined;
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
