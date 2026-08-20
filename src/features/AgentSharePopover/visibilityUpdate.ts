export type AgentShareVisibilityCommitResult = 'copied' | 'updated' | 'updated-copy-failed';

interface CommitAgentShareVisibilityOptions {
  copyLink: () => Promise<void>;
  shouldCopyLink: boolean;
  updateVisibility: () => Promise<unknown>;
}

/** Copy a share link without leaking clipboard rejection into an event handler. */
export const copyAgentShareLink = async (copyLink: () => Promise<void>): Promise<boolean> => {
  try {
    await copyLink();
    return true;
  } catch {
    return false;
  }
};

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

  return (await copyAgentShareLink(copyLink)) ? 'copied' : 'updated-copy-failed';
};
