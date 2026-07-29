import { lambdaClient } from '@/libs/trpc/client';
import { type RecentItem } from '@/server/routers/lambda/recent';

class RecentService {
  getAll = (limit?: number, types?: RecentItem['type'][]): Promise<RecentItem[]> => {
    return lambdaClient.recent.getAll.query({ limit, types });
  };
}

export const recentService = new RecentService();
