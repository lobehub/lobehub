import { lambdaClient } from '@/libs/trpc/client';
import { type RecentItem } from '@/server/routers/lambda/recent';

class RecentService {
  getAll = (
    limit?: number,
    types?: RecentItem['type'][],
    withTopicPreview?: boolean,
    view?: 'mine' | 'team',
  ): Promise<RecentItem[]> => {
    return lambdaClient.recent.getAll.query({ limit, types, view, withTopicPreview });
  };
}

export const recentService = new RecentService();
