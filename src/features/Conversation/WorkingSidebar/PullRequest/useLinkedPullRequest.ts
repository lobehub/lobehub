import type { DeviceGitLinkedPullRequest, WorkingDirGithubState } from '@lobechat/types';

import { type GitLinkedPRSummary } from '@/services/git';
import { useFetchGitBranch, useFetchGitLinkedPR } from '@/store/device';

/** The git context the topic recorded for the working directory. */
export interface PullRequestSnapshot {
  branch?: string;
  github?: WorkingDirGithubState;
}

interface ResolveLinkedPullRequestInput {
  /** The working directory is readable here (local machine or a bound device). */
  available: boolean;
  branch?: { branch?: string; detached?: boolean };
  branchConfirmed: boolean;
  branchError?: unknown;
  linkedPR?: GitLinkedPRSummary;
  linkedPRConfirmed: boolean;
  linkedPRError?: unknown;
  snapshot?: PullRequestSnapshot;
}

/**
 * The PR the sidebar shows for the working directory, and whether it may be
 * acted on. Persisted rows and the topic snapshot are enough to paint the tab;
 * only a PR that this session's branch read and linked-PR lookup both
 * confirmed may be mutated — a stale row could otherwise close or merge a PR
 * the repository has since moved off.
 *
 * `confirmError`: the failed read that keeps an unconfirmed PR locked, so the
 * pane can say why and retry it.
 */
export const resolveLinkedPullRequest = ({
  available,
  branch,
  branchConfirmed,
  branchError,
  linkedPR,
  linkedPRConfirmed,
  linkedPRError,
  snapshot,
}: ResolveLinkedPullRequestInput): {
  confirmError: unknown;
  confirmed: boolean;
  pullRequest: DeviceGitLinkedPullRequest | null | undefined;
} => {
  const snapshotPR =
    !branch || (snapshot?.branch === branch.branch && !branch.detached)
      ? snapshot?.github?.pullRequest
      : undefined;
  // A settled empty lookup supersedes the snapshot; failures may keep displaying it.
  const pullRequest = available
    ? linkedPR?.pullRequestStatus === 'ok'
      ? linkedPR.pullRequest
      : (linkedPR?.pullRequest ?? snapshotPR)
    : undefined;
  const confirmed =
    !!pullRequest &&
    branchConfirmed &&
    linkedPRConfirmed &&
    linkedPR?.pullRequest?.number === pullRequest.number;
  const confirmError = confirmed
    ? undefined
    : (!branchConfirmed && branchError) || (!linkedPRConfirmed && linkedPRError) || undefined;
  return { confirmError, confirmed, pullRequest };
};

/** Branch → linked PR for the Working Sidebar's PR tab. */
export const useLinkedPullRequest = ({
  available,
  deviceId,
  gitPath,
  isGithub,
  snapshot,
}: {
  available: boolean;
  deviceId?: string;
  /** Set only for a readable GitHub working directory. */
  gitPath?: string;
  isGithub: boolean;
  snapshot?: PullRequestSnapshot;
}) => {
  const {
    data: branch,
    error: branchError,
    isConfirmed: branchConfirmed,
    mutate: refreshBranch,
  } = useFetchGitBranch(deviceId, gitPath);
  const {
    data: linkedPR,
    error: linkedPRError,
    isConfirmed: linkedPRConfirmed,
    mutate: refresh,
  } = useFetchGitLinkedPR(deviceId, gitPath, branch?.branch, isGithub);
  return {
    ...resolveLinkedPullRequest({
      available,
      branch,
      branchConfirmed,
      branchError,
      linkedPR,
      linkedPRConfirmed,
      linkedPRError,
      snapshot,
    }),
    /** Re-run the reads that confirm the PR (branch, then its linked PR). */
    onRetryConfirm: () => {
      void refreshBranch();
      void refresh();
    },
    refresh,
  };
};
