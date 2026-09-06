import type { SidebarAgentListResponse } from '@lobechat/types';

import {
  LocalStorageQueryProjectionStorage,
  QueryProjectionWriteQueue,
} from '@/libs/queryProjectionStorage';

export const AGENT_LIST_QUERY = 'sidebar';
export const agentListProjection = new LocalStorageQueryProjectionStorage<SidebarAgentListResponse>(
  {
    namespace: 'lobechat-agent-list-v1',
  },
);
export const agentListWriteQueue = new QueryProjectionWriteQueue(agentListProjection);
