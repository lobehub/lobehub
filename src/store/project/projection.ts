import {
  IndexedDBQueryProjectionStorage,
  QueryProjectionWriteQueue,
} from '@/libs/queryProjectionStorage';

import type { ProjectDetail, ProjectListItem } from './store';

export const PROJECT_LIST_QUERY = 'all';
export const projectListProjection = new IndexedDBQueryProjectionStorage<ProjectListItem[]>({
  namespace: 'lobechat-project-list-v1',
});
export const projectDetailProjection = new IndexedDBQueryProjectionStorage<ProjectDetail>({
  namespace: 'lobechat-project-detail-v1',
});
export const projectListWriteQueue = new QueryProjectionWriteQueue(projectListProjection);
export const projectDetailWriteQueue = new QueryProjectionWriteQueue(projectDetailProjection);
