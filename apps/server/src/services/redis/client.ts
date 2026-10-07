import { getRedisConfig } from '@/envs/redis';

import { RedisKeyNamespace, tryInitializeRedisWithPrefix } from './internal';

// Domains share one connection. Keep the deployed prefix for cache compatibility.
export const getRedisServiceClient = () =>
  tryInitializeRedisWithPrefix(getRedisConfig(), RedisKeyNamespace.SEND_PATH_CACHE);
