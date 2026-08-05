import { lambdaClient } from '@/libs/trpc/client';
import { type RecentItem } from '@/server/routers/lambda/recent';

class RecentService {
  getAll = (
    limit?: number,
    types?: RecentItem['type'][],
    withTopicPreview?: boolean,
    mineOnly?: boolean,
  ): Promise<RecentItem[]> => {
    return lambdaClient.recent.getAll.query({ limit, mineOnly, types, withTopicPreview });
  };
}

export const recentService = new RecentService();
