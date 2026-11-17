import type { ChatTopicMetadata, OwnedWorktree } from '@lobechat/types';
import { getTopicWorktreePaths, resolveOwnedWorktrees } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { t } from 'i18next';

import { restoreOwnedWorktree } from '@/services/ownedWorktree';
import type { ChatTopic } from '@/types/topic';

/**
 * The worktree the app created for this topic that its next turn runs in (its
 * CLI start folder or current worktree), unless the user keeps it by hand.
 */
const worktreeForRun = (metadata: ChatTopicMetadata | undefined): OwnedWorktree | undefined => {
  const paths = getTopicWorktreePaths(metadata);
  if (paths.length === 0) return;
  return resolveOwnedWorktrees(metadata).find((entry) => paths.includes(entry.path));
};

/** How long a turn waits for a cleanup that is deleting its worktree right now. */
const BUSY_WAIT_MS = 120_000;
const BUSY_POLL_MS = 2000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask until the worktree is no longer mid-cleanup: a topic restored while its
 * archive cleanup is still deleting the folder waits for that to finish, then
 * checks it out again — it never starts its turn in a folder about to vanish.
 */
const restoreWhenSettled = async (topicId: string, entry: OwnedWorktree) => {
  const deadline = Date.now() + BUSY_WAIT_MS;
  let waiting: { close: () => void } | undefined;
  try {
    for (;;) {
      const result = await restoreOwnedWorktree(topicId, entry);
      if (result.outcome !== 'busy' || Date.now() > deadline) return result;
      waiting ??= toast.loading(t('worktreeRestore.waiting', { ns: 'chat' }));
      await sleep(BUSY_POLL_MS);
    }
  } finally {
    waiting?.close();
  }
};

/** The directory a topic continues in once its worktree's branch is gone. */
const sourceFallback = (metadata: ChatTopicMetadata, entry: OwnedWorktree): ChatTopicMetadata => {
  const config = metadata.workingDirectoryConfig;
  return {
    ...metadata,
    workingDirectory: entry.sourcePath,
    workingDirectoryConfig: {
      ...(config?.environmentId && { environmentId: config.environmentId }),
      path: entry.sourcePath,
      ...(config?.repoType && { repoType: config.repoType }),
    },
  };
};

/**
 * Before a turn runs in a topic brought back from the archive or the recycle
 * bin, check out again the worktree the app created for it and the cleanup
 * removed — same path, same branch (`git worktree add <path> <branch>`), so the
 * CLI session keyed by that folder resumes. A gone branch moves the topic back
 * to its source repository, which the server records and this turn uses.
 *
 * Never blocks the turn: any other failure is shown and the turn proceeds,
 * where the missing directory surfaces through the usual spawn guide.
 */
export const ensureOwnedWorktreeForRun = async (
  topic: ChatTopic | undefined,
): Promise<ChatTopic | undefined> => {
  const metadata = topic?.metadata;
  const entry = worktreeForRun(metadata);
  if (!topic || !metadata || !entry) return topic;

  try {
    // The server answers from its record, touching the device only for a
    // folder that was removed.
    const result = await restoreWhenSettled(topic.id, entry);
    if (result.outcome === 'restored') return topic;
    if (result.outcome === 'branchMissing') {
      toast.warning({
        description: t('worktreeRestore.branchMissingDesc', {
          branch: entry.branch ?? '',
          ns: 'chat',
        }),
        title: t('worktreeRestore.branchMissing', { ns: 'chat' }),
      });
      const next = { ...topic, metadata: sourceFallback(metadata, entry) };
      const { getChatStoreState } = await import('@/store/chat');
      getChatStoreState().internal_dispatchTopic(
        { id: topic.id, type: 'updateTopic', value: { metadata: next.metadata } },
        'ensureOwnedWorktreeForRun/branchMissing',
      );
      return next;
    }
    toast.error({
      description:
        result.outcome === 'busy'
          ? t('worktreeRestore.stillCleaning', { ns: 'chat' })
          : result.error,
      title: t('worktreeRestore.failed', { ns: 'chat' }),
    });
  } catch (error) {
    console.warn('[ensureOwnedWorktreeForRun] restore failed:', error);
  }
  return topic;
};
