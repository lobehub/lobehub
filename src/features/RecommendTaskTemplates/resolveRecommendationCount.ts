import { TASK_TEMPLATE_RECOMMEND_COUNT, TASK_TEMPLATE_RECOMMEND_COUNT_MAX } from '@lobechat/const';

export const resolveRecommendationCount = (count?: number) =>
  Math.max(1, Math.min(count ?? TASK_TEMPLATE_RECOMMEND_COUNT, TASK_TEMPLATE_RECOMMEND_COUNT_MAX));
