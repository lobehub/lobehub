import { createHash } from 'node:crypto';

import type { LinkPreview } from '@lobechat/types';

import { getJSONFromRedis, RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

/** A page's card changes rarely; a day keeps a busy link to one fetch. */
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
/** A page with no card is asked again sooner. */
const EMPTY_TTL_MS = 60 * 60 * 1000;
/**
 * A fetch that failed (timeout, refused, throttled by a site answering a burst
 * of links) is retried soon: it says nothing about whether the page has a card.
 */
const FAILED_TTL_MS = 5 * 60 * 1000;

interface StoredPreview {
  preview: LinkPreview | null;
}

const getClient = () => getRedisServiceClient('lobechat');
const keyOf = (url: string) =>
  RedisKeys.lobechat.linkPreview(createHash('sha256').update(url).digest('hex'));

export const linkPreview = {
  /**
   * A page's preview, shared by every viewer and message that links it. The
   * page is public and read without credentials, so one answer serves all.
   * "No preview" is remembered too, for an hour, so a card-less link is not
   * re-fetched on every render; a `resolve` that throws counts as "no preview"
   * for five minutes only. Without Redis each call reads live.
   */
  async remember(
    url: string,
    resolve: () => Promise<LinkPreview | null>,
  ): Promise<LinkPreview | null> {
    const redis = await getClient();
    if (!redis) return resolve();

    const key = keyOf(url);
    const cached = await getJSONFromRedis<StoredPreview>(redis, key).catch(() => null);
    if (cached) return cached.preview;

    let preview: LinkPreview | null;
    let ttl: number;
    try {
      preview = await resolve();
      ttl = preview ? PREVIEW_TTL_MS : EMPTY_TTL_MS;
    } catch {
      preview = null;
      ttl = FAILED_TTL_MS;
    }
    const stored: StoredPreview = { preview };
    void redis.set(key, JSON.stringify(stored), { px: ttl }).catch(() => undefined);
    return preview;
  },
};
