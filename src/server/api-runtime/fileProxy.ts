import debug from 'debug';

import { FileModel } from '@/database/models/file';
import { getServerDB } from '@/database/server';
import { getRedisConfig } from '@/envs/redis';
import { initializeRedis, isRedisEnabled } from '@/libs/redis';
import { FileService } from '@/server/services/file';

const log = debug('lobe-file:proxy');

const FILE_PROXY_KEY_PREFIX = 'file-proxy:';
const PRESIGNED_URL_CACHE_TTL = 240;

const buildCacheKey = (id: string) => `${FILE_PROXY_KEY_PREFIX}${id}`;

interface CachedFileData {
  redirectUrl: string;
}

export const fileProxyAPIHandler = async (
  _request: Request,
  params: { id: string },
): Promise<Response> => {
  try {
    const { id } = params;

    log('File proxy request: %s', id);

    const redisConfig = getRedisConfig();
    const redisClient = isRedisEnabled(redisConfig) ? await initializeRedis(redisConfig) : null;

    const cacheKey = buildCacheKey(id);
    if (redisClient) {
      const cachedStr = await redisClient.get(cacheKey);
      const cached = cachedStr ? (JSON.parse(cachedStr) as CachedFileData) : null;
      if (cached?.redirectUrl) {
        log('Cache hit for file: %s', id);
        return Response.redirect(cached.redirectUrl, 302);
      }
      log('Cache miss for file: %s', id);
    }

    const db = await getServerDB();
    const file = await FileModel.getFileById(db, id);

    if (!file) {
      log('File not found: %s', id);
      return new Response('File not found', {
        status: 404,
      });
    }

    const fileService = new FileService(db, file.userId);
    const redirectUrl = await fileService.getFullFileUrl(file.url, 300);
    log('Web S3 presigned URL generated (expires in 5 min)');

    if (redisClient) {
      await redisClient.set(cacheKey, JSON.stringify({ redirectUrl }), {
        ex: PRESIGNED_URL_CACHE_TTL,
      });
      log('Cached presigned URL for file: %s (TTL: %ds)', id, PRESIGNED_URL_CACHE_TTL);
    }

    return Response.redirect(redirectUrl, 302);
  } catch (error) {
    console.error('File proxy error:', error);
    return new Response('Internal server error', {
      status: 500,
    });
  }
};
