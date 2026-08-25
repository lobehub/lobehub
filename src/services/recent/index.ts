import { lambdaClient } from '@/libs/trpc/client';
import { type RecentItem } from '@/server/routers/lambda/recent';

export const RECENT_SIDEBAR_TYPES = [
  'document',
  'task',
] as const satisfies readonly RecentItem['type'][];

class RecentService {
  getAll = (
    limit?: number,
    types?: readonly RecentItem['type'][],
    withTopicPreview?: boolean,
    mineOnly?: boolean,
  ): Promise<RecentItem[]> => {
    return lambdaClient.recent.getAll.query({
      limit,
      mineOnly,
      types: types ? [...types] : undefined,
      withTopicPreview,
    });
  };
}

export const recentService = new RecentService();
