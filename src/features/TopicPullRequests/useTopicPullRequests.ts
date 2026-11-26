import { useMemo } from 'react';

import { gitPullRequestKey } from '@/store/device/gitReview/projection';
import { useGitReviewStore } from '@/store/device/gitReview/store';
import { useWorkStore, workActions, workSelectors } from '@/store/work';

import {
  pickPrimaryPullRequest,
  resolvePullRequestView,
  type TopicPullRequestView,
} from './pullRequestView';
import type { TopicPullRequestProbe } from './TopicPullRequestProbes';

export interface UseTopicPullRequestsParams {
  /** Execution device of the working directory; omitted for this machine. */
  deviceId?: string;
  /** Working directory the device answers `gh pr view` in; omitted → no device read. */
  path?: string;
  topicId?: string | null;
}

export interface TopicPullRequests {
  primary?: TopicPullRequestView;
  /**
   * Numbers to read on the execution device (mount {@link TopicPullRequestProbes}):
   * all of them, since only the device says which ones live in the working
   * directory's repository — the ones the sidebar PR pane can open.
   */
  probes: TopicPullRequestProbe[];
  views: TopicPullRequestView[];
}

/**
 * The pull requests a topic's Work rows link, each resolved to a displayable
 * state. Before a topic exists (new conversation) nothing is read and the list
 * is empty.
 */
export const useTopicPullRequests = ({
  deviceId,
  path,
  topicId,
}: UseTopicPullRequestsParams): TopicPullRequests => {
  const activeTopicId = topicId || undefined;

  workActions.useFetchTopicPullRequests(activeTopicId ? { topicId: activeTopicId } : null);
  const items = useWorkStore(workSelectors.topicPullRequests(activeTopicId));

  const detailMap = useGitReviewStore((s) => s.gitPullRequestDetailMap);
  const detailEntries = useGitReviewStore((s) => s.gitPullRequestDetailReplica.entries);

  return useMemo(() => {
    const list = items ?? [];
    const views = list.map((item) => {
      if (!path) return resolvePullRequestView(item);
      const key = gitPullRequestKey({ deviceId, number: item.number, path });
      const detail = detailMap[key]?.value?.detail;
      return resolvePullRequestView(
        item,
        detail ? { confirmed: detailEntries[key]?.source === 'server', detail } : undefined,
      );
    });
    return {
      probes: path
        ? list.map((item) => ({ number: item.number, version: new Date(item.linkedAt).getTime() }))
        : [],
      primary: pickPrimaryPullRequest(views),
      views,
    };
  }, [detailEntries, detailMap, deviceId, items, path]);
};
