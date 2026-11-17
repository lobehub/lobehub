import { isDesktop } from '@lobechat/const';
import type { ChatTopicMetadata, OwnedWorktree } from '@lobechat/types';
import { getTopicWorktreePaths, resolveOwnedWorktrees } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { t } from 'i18next';

import { isLocalOwnedWorktree, restoreOwnedWorktree } from '@/services/ownedWorktree';
import type { ChatTopic } from '@/types/topic';
import { ensureElectronIpc } from '@/utils/electron/ipc';

/**
 * The worktree the app created for this topic that its next turn runs in (its
 * CLI start folder or current worktree), unless the user keeps it by hand.
 */
const worktreeForRun = (metadata: ChatTopicMetadata | undefined): OwnedWorktree | undefined => {
  const paths = getTopicWorktreePaths(metadata);
  if (paths.length === 0) return;
  return resolveOwnedWorktrees(metadata).find((entry) => paths.includes(entry.path));
};

/** Whether the folder is there, checked on this desktop without a round trip. */
const existsLocally = async (path: string): Promise<boolean | undefined> => {
  if (!isDesktop) return;
  try {
    const stat = await ensureElectronIpc().workspace.statPath({ path });
    return stat.exists && stat.isDirectory;
  } catch {
    return;
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

  const local = await isLocalOwnedWorktree(entry);
  // On this desktop a present folder needs nothing; elsewhere the server
  // answers from its record without touching the device unless it was removed.
  if (local && (await existsLocally(entry.path)) !== false) return topic;

  try {
    const result = await restoreOwnedWorktree(topic.id, entry);
    if (result.outcome === 'restored') return topic;
    if (result.outcome === 'branchMissing') {
      toast.warning({
        description: t('workingDirectory.worktreeRestore.branchMissingDesc', {
          branch: entry.branch ?? '',
          ns: 'device',
        }),
        title: t('workingDirectory.worktreeRestore.branchMissing', { ns: 'device' }),
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
      description: result.error,
      title: t('workingDirectory.worktreeRestore.failed', { ns: 'device' }),
    });
  } catch (error) {
    console.warn('[ensureOwnedWorktreeForRun] restore failed:', error);
  }
  return topic;
};
