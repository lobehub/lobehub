import type { ChatTopicMetadata } from '@lobechat/types';

import {
  getPendingSandboxSelection,
  toSandboxTopicMetadata,
} from '@/store/chat/pendingSandboxSelection';
import { getPendingTopicRepos } from '@/store/chat/pendingTopicRepos';

/**
 * The metadata a NEW server topic is born with; `undefined` for an existing topic.
 *
 * Repos the user pre-selected before the first message are read without
 * consuming them — if execAgentTask fails or is aborted, the selection is
 * preserved so a retry can still pick it up; the caller clears it only after
 * the server confirms the topic was created.
 *
 * Pending repo selection wins; otherwise carry the caller-resolved topic
 * metadata (e.g. the hetero cwd `conversationLifecycle` resolved from the
 * effective device + per-user legacy slot) so the SERVER topic is born with it
 * — the server can't read client-local state, and without this a workspace
 * hetero run's first send would fall back to the device default cwd instead of
 * the member's pick.
 *
 * The sandbox instance the composer bound before any topic existed is merged
 * rather than folded into the cwd branches: it is orthogonal to the cwd, and a
 * conversation can start with one, the other, or both.
 */
export const resolveInitialTopicMetadata = (params: {
  /** Optimistic row metadata, else an isolated handoff topic's cwd. */
  callerTopicMetadata: ChatTopicMetadata | undefined;
  isCreateNewTopic: boolean;
  repoAgentId: string | undefined;
  sandboxAgentId: string | undefined;
}): ChatTopicMetadata | undefined => {
  const { callerTopicMetadata, isCreateNewTopic, repoAgentId, sandboxAgentId } = params;
  if (!isCreateNewTopic) return;

  const pendingRepos = repoAgentId ? getPendingTopicRepos(repoAgentId) : [];
  const sandboxTopicMetadata = toSandboxTopicMetadata(
    sandboxAgentId ? getPendingSandboxSelection(sandboxAgentId) : undefined,
  );
  const cwdTopicMetadata =
    pendingRepos.length > 0
      ? {
          repos: pendingRepos,
          workingDirectory: pendingRepos[0],
          workingDirectoryConfig: { path: pendingRepos[0], repoType: 'github' as const },
        }
      : callerTopicMetadata?.workingDirectory
        ? {
            repos: callerTopicMetadata.repos,
            workingDirectory: callerTopicMetadata.workingDirectory,
            workingDirectoryConfig: callerTopicMetadata.workingDirectoryConfig,
          }
        : undefined;

  return cwdTopicMetadata || sandboxTopicMetadata
    ? { ...cwdTopicMetadata, ...sandboxTopicMetadata }
    : undefined;
};
