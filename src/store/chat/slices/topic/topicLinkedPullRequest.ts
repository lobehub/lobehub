import { useEffect, useRef } from 'react';

import type { GitLinkedPRSummary } from '@/services/git';
import { gitLinkedPRKey } from '@/store/device/gitReview/projection';
import { useGitReviewStore } from '@/store/device/gitReview/store';

export interface TopicLinkedPullRequestRefreshParams {
  branch: string;
  deviceId?: string;
  path: string;
  pullRequestNumber?: number;
  topicId: string;
}

/** Forwarded to SWR as given: a failed `gh` lookup is not retried. */
const NO_RETRY = { shouldRetryOnError: false };

/**
 * Keep a topic's recorded PR state current. Reads through the device's
 * linked-PR replica, so with no recorded PR number it shares the composer's
 * row and request for the same branch. Every device answer for that row is
 * written back to the topic — also one the composer fetched before this hook
 * mounted (inside the dedupe window no new response arrives). A row hydrated
 * from storage is not proof and is never written back.
 */
export const useTopicLinkedPullRequestSync = (
  params: TopicLinkedPullRequestRefreshParams | undefined,
  writeBack: (
    params: TopicLinkedPullRequestRefreshParams,
    pr?: GitLinkedPRSummary,
  ) => Promise<void>,
) => {
  const replicaParams = params
    ? {
        branch: params.branch,
        deviceId: params.deviceId,
        path: params.path,
        pullRequestNumber: params.pullRequestNumber,
      }
    : null;
  const key = replicaParams ? gitLinkedPRKey(replicaParams) : undefined;

  const sync = useGitReviewStore.getState().slices.linkedPR.useSync(replicaParams, {
    dedupingInterval: 60 * 1000,
    focusThrottleInterval: 60 * 1000,
    revalidateOnFocus: true,
    ...NO_RETRY,
  });

  const confirmed = useGitReviewStore((s) =>
    key && s.gitLinkedPRReplica.entries[key]?.source === 'server'
      ? s.gitLinkedPRMap[key]
      : undefined,
  );
  const latest = useRef({ params, writeBack });
  latest.current = { params, writeBack };

  useEffect(() => {
    const { params: current, writeBack: write } = latest.current;
    if (!confirmed || !current) return;

    void write(current, confirmed.value).catch((error) => {
      console.error('[useFetchTopicLinkedPullRequest] sync failed:', error);
    });
  }, [confirmed, params?.topicId]);

  return sync;
};
