import type { RecentItem } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

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
    /** Drop topics owned by a private agent/group — the team tab's feed. */
    sharedOnly?: boolean,
  ): Promise<RecentItem[]> => {
    return lambdaClient.recent.getAll.query({
      limit,
      mineOnly,
      sharedOnly,
      types: types ? [...types] : undefined,
      withTopicPreview,
    });
  };
}

export const recentService = new RecentService();
