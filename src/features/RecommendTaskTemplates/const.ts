/**
 * Replica name of the daily recommendations (`dailyRecommendResource`). Kept
 * dependency-free so the user store can revalidate it by name: importing the
 * resource there would evaluate `defineReplica` inside the `@/libs/replica` ↔
 * `@/store/user` import cycle, before the replica module has initialized.
 */
export const TASK_TEMPLATE_DAILY_RECOMMEND_REPLICA = 'taskTemplateDailyRecommend';
