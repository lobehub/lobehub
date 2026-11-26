import { workService } from '@/services/work';

export const linkManualPullRequest = async (topicId: string, url: string): Promise<string> => {
  const { identifier, linked } = await workService.linkTopicPullRequest({
    source: 'manual',
    topicId,
    url,
  });
  if (!linked) throw new Error(`Could not link ${identifier}`);
  await workService.refreshTopicPullRequests(topicId);
  return identifier;
};
