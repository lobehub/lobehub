import type { ChatTopic } from '@/types/topic';

export const getOnboardingHistoryTopics = (topics: ChatTopic[]) =>
  [...topics].sort((left, right) => +new Date(right.updatedAt) - +new Date(left.updatedAt));
