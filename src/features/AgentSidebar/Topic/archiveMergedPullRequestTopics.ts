import type { DeviceGitPullRequestDetail, TopicPullRequestItem } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { type TFunction } from 'i18next';

import { workService } from '@/services/work';
import { useChatStore } from '@/store/chat';
import { useGitReviewStore } from '@/store/device/gitReview/store';
import { type ChatTopic } from '@/types/topic';

import {
  getArchivableTopics,
  getMergedPullRequestTopics,
  pullRequestIdentityKey,
} from './utils/mergedPullRequestTopics';

/** Topic ids per server read — the `work.listTopicsPullRequests` input bound. */
const TOPIC_BATCH = 100;

/**
 * Merges seen by the execution devices' `gh pr view` reads loaded in this
 * client — in practice, PRs of topics opened in this session. Only merges:
 * merged is final, while an older "open" read must not hide a merge the server
 * knows of.
 */
const readDeviceMergedPullRequests = () => {
  const details = new Map<string, DeviceGitPullRequestDetail>();
  for (const read of Object.values(useGitReviewStore.getState().gitPullRequestDetailMap)) {
    const detail = read?.value?.detail;
    if (detail?.state !== 'merged') continue;
    details.set(
      pullRequestIdentityKey(`${detail.repo.owner}/${detail.repo.name}`, detail.number),
      detail,
    );
  }
  return details;
};

/**
 * Of the given topics, the open ones whose linked pull requests have landed —
 * read from their Work rows and topic links in one server read per 100 topics.
 */
export const findMergedPullRequestTopics = async (
  topics: ChatTopic[],
  ownerId?: string | null,
): Promise<ChatTopic[]> => {
  const candidates = getArchivableTopics(topics, ownerId);
  if (candidates.length === 0) return [];

  const ids = candidates.map((topic) => topic.id);
  const pullRequestsByTopic: Record<string, TopicPullRequestItem[]> = {};
  // One read at a time: a long topic list must not turn into a burst.
  for (let i = 0; i < ids.length; i += TOPIC_BATCH) {
    Object.assign(
      pullRequestsByTopic,
      await workService.listTopicsPullRequests(ids.slice(i, i + TOPIC_BATCH)),
    );
  }

  return getMergedPullRequestTopics(
    candidates,
    pullRequestsByTopic,
    readDeviceMergedPullRequests(),
  );
};

/**
 * "Archive merged PR topics": mark every open topic among `topics` whose pull
 * requests have landed as completed, and tell the user how many.
 */
export const archiveMergedPullRequestTopics = async ({
  ownerId,
  t,
  topics,
}: {
  /** Keep only this user's topics (a workspace member's own scope). */
  ownerId?: string | null;
  t: TFunction<'topic'>;
  topics: ChatTopic[];
}) => {
  let merged: ChatTopic[];
  try {
    merged = await findMergedPullRequestTopics(topics, ownerId);
  } catch (error) {
    console.error('[archiveMergedPullRequestTopics]', error);
    toast.error(t('actions.archiveMergedPullRequestsFailed'));
    return;
  }

  if (merged.length === 0) {
    toast.info(t('actions.archiveMergedPullRequestsNone'));
    return;
  }

  const { refreshTopic, updateTopicStatus } = useChatStore.getState();
  await Promise.all(
    merged.map(({ id }) => updateTopicStatus({ status: 'completed', topicId: id })),
  );
  await refreshTopic();
  toast.success(t('actions.archiveMergedPullRequestsSuccess', { count: merged.length }));
};
