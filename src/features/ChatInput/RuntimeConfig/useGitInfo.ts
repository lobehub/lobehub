import { isDesktop } from '@lobechat/const';
import type { GitLinkedPullRequest } from '@lobechat/electron-client-ipc';

import { useClientDataSWR } from '@/libs/swr';
import { electronGitService } from '@/services/electron/git';

export interface GitInfo {
  branch?: string;
  detached?: boolean;
  extraCount?: number;
  ghMissing?: boolean;
  pullRequest?: GitLinkedPullRequest | null;
}

const fetchGitInfo = async (dirPath: string, isGithub: boolean): Promise<GitInfo> => {
  const { branch, detached } = await electronGitService.getGitBranch(dirPath);
  if (!branch) return {};

  // Skip PR lookup for detached HEAD or non-github repos
  if (detached || !isGithub) return { branch, detached };

  const prResult = await electronGitService.getLinkedPullRequest({ branch, path: dirPath });
  return {
    branch,
    detached,
    extraCount: prResult.extraCount,
    ghMissing: prResult.status === 'gh-missing',
    pullRequest: prResult.pullRequest,
  };
};

export const useGitInfo = (dirPath?: string, isGithub: boolean = false) => {
  const key = isDesktop && dirPath ? ['git-info', dirPath, isGithub] : null;

  return useClientDataSWR<GitInfo>(key, () => fetchGitInfo(dirPath!, isGithub), {
    // Prevent gh spam: dedupe within 60s + throttle focus revalidation to 60s
    dedupingInterval: 60 * 1000,
    focusThrottleInterval: 60 * 1000,
    // gh may not be installed — don't retry aggressively
    shouldRetryOnError: false,
  });
};
