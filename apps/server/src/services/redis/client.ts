import { getRedisConfig } from '@/envs/redis';
import { RedisKeyNamespace, tryInitializeRedisWithPrefix } from '@/server/modules/Redis';

// Domains share one connection. Keep the deployed prefix for cache compatibility.
export const getRedisServiceClient = () =>
  tryInitializeRedisWithPrefix(getRedisConfig(), RedisKeyNamespace.SEND_PATH_CACHE);
