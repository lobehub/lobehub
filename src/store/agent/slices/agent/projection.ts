import {
  IndexedDBQueryProjectionStorage,
  QueryProjectionWriteQueue,
} from '@/libs/queryProjectionStorage';
import type { LobeAgentConfig } from '@/types/agent';

export const agentConfigProjection = new IndexedDBQueryProjectionStorage<LobeAgentConfig>({
  namespace: 'lobechat-agent-config-v1',
});
export const agentConfigWriteQueue = new QueryProjectionWriteQueue(agentConfigProjection);
