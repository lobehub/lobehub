import { type ChatTopic } from '@/types/topic';

export interface ProjectTopicStatusCounts {
  failed: number;
  loading: number;
  waitingForHuman: number;
}

export const EMPTY_PROJECT_TOPIC_STATUS_COUNTS: ProjectTopicStatusCounts = {
  failed: 0,
  loading: 0,
  waitingForHuman: 0,
};

export const getProjectTopicStatusCounts = (
  topics: ChatTopic[],
  loadingTopicIds: ReadonlySet<string>,
): ProjectTopicStatusCounts =>
  topics.reduce<ProjectTopicStatusCounts>(
    (counts, topic) => {
      if (topic.status === 'waitingForHuman') {
        counts.waitingForHuman += 1;
        return counts;
      }

      if (loadingTopicIds.has(topic.id) || topic.status === 'running') {
        counts.loading += 1;
        return counts;
      }

      if (topic.status === 'failed') {
        counts.failed += 1;
      }

      return counts;
    },
    { ...EMPTY_PROJECT_TOPIC_STATUS_COUNTS },
  );

export const hasProjectTopicStatusCounts = (counts: ProjectTopicStatusCounts) =>
  counts.loading > 0 || counts.waitingForHuman > 0 || counts.failed > 0;
