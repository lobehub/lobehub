export type AgentShareVisibilityCommitResult = 'copied' | 'updated' | 'updated-copy-failed';

interface CommitAgentShareVisibilityOptions {
  copyLink: () => Promise<void>;
  shouldCopyLink: boolean;
  updateVisibility: () => Promise<unknown>;
}

/**
 * Commit visibility before attempting the convenience clipboard write.
 * Clipboard permission failures must not be reported as a failed visibility
 * mutation: at that point the share is already reachable through its link.
 */
export const commitAgentShareVisibility = async ({
  copyLink,
  shouldCopyLink,
  updateVisibility,
}: CommitAgentShareVisibilityOptions): Promise<AgentShareVisibilityCommitResult> => {
  await updateVisibility();
  if (!shouldCopyLink) return 'updated';

  try {
    await copyLink();
    return 'copied';
  } catch {
    return 'updated-copy-failed';
  }
};
