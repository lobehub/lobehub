import type { DeviceGitPullRequestDetail } from '@lobechat/types';
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

/** The device `gh pr view` answers this client holds (persisted or read this session). */
const readDevicePullRequestDetails = () => {
  const details = new Map<string, DeviceGitPullRequestDetail>();
  for (const read of Object.values(useGitReviewStore.getState().gitPullRequestDetailMap)) {
    const detail = read?.value?.detail;
    if (!detail) continue;
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
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += TOPIC_BATCH) batches.push(ids.slice(i, i + TOPIC_BATCH));
  const results = await Promise.all(
    batches.map((batch) => workService.listTopicsPullRequests(batch)),
  );

  return getMergedPullRequestTopics(
    candidates,
    Object.assign({}, ...results),
    readDevicePullRequestDetails(),
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
