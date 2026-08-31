import type { RecentItem } from '@lobechat/types';

import { LocalStorageQueryProjectionStorage } from '@/libs/queryProjectionStorage';

export const recentProjection = new LocalStorageQueryProjectionStorage<RecentItem[]>({
  namespace: 'lobechat-home-recents-v3',
});
