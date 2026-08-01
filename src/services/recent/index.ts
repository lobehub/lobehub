import { lambdaClient } from '@/libs/trpc/client';
import { type RecentItem } from '@/server/routers/lambda/recent';

class RecentService {
  getAll = (
    limit?: number,
    types?: RecentItem['type'][],
    withTopicPreview?: boolean,
  ): Promise<RecentItem[]> => {
    return lambdaClient.recent.getAll.query({ limit, types, withTopicPreview });
  };
}

export const recentService = new RecentService();
