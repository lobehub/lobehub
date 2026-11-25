import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LinkPreviewRateLimitedError,
  LinkPreviewUnavailableError,
} from '@/server/services/linkPreview/errors';

import { linkPreview } from './linkPreview';

const { get, incr, set } = vi.hoisted(() => ({ get: vi.fn(), incr: vi.fn(), set: vi.fn() }));
let redisAvailable = true;
vi.mock('./client', () => ({
  getRedisServiceClient: async () => (redisAvailable ? { get, incr, set } : null),
}));

const URL = 'https://example.com/post';
const KEY = `link_preview:v1:${createHash('sha256').update(URL).digest('hex')}`;
const DAY = 24 * 60 * 60 * 1000;

describe('redisService.linkPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisAvailable = true;
    get.mockResolvedValue(null);
    set.mockResolvedValue('OK');
  });

  it('shares a card for a day and serves the next viewer from the cache', async () => {
    const card = { title: 'Hello', url: URL };
    const resolve = vi.fn().mockResolvedValue(card);

    await expect(linkPreview.remember(URL, resolve)).resolves.toEqual(card);
    expect(set).toHaveBeenCalledWith(KEY, JSON.stringify({ preview: card }), { px: DAY });

    get.mockResolvedValue(JSON.stringify({ preview: card }));
    await expect(linkPreview.remember(URL, resolve)).resolves.toEqual(card);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('remembers a page without a card for an hour, so it is not re-fetched per render', async () => {
    const resolve = vi.fn().mockResolvedValue(null);

    await expect(linkPreview.remember(URL, resolve)).resolves.toBe(null);
    expect(set).toHaveBeenCalledWith(KEY, JSON.stringify({ preview: null }), { px: DAY / 24 });

    get.mockResolvedValue(JSON.stringify({ preview: null }));
    await expect(linkPreview.remember(URL, resolve)).resolves.toBe(null);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('remembers a failed fetch for five minutes as a failure, never as "no card"', async () => {
    const resolve = vi.fn().mockRejectedValue(new Error('timeout'));

    await expect(linkPreview.remember(URL, resolve)).rejects.toBeInstanceOf(
      LinkPreviewUnavailableError,
    );
    expect(set).toHaveBeenCalledWith(KEY, JSON.stringify({ failed: true }), { px: 5 * 60 * 1000 });

    // The next viewer within five minutes gets the same failure without a fetch.
    get.mockResolvedValue(JSON.stringify({ failed: true }));
    await expect(linkPreview.remember(URL, resolve)).rejects.toBeInstanceOf(
      LinkPreviewUnavailableError,
    );
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('does not cache a user hitting their budget, so the next viewer still reads the page', async () => {
    const resolve = vi.fn().mockRejectedValue(new LinkPreviewRateLimitedError());

    await expect(linkPreview.remember(URL, resolve)).rejects.toBeInstanceOf(
      LinkPreviewRateLimitedError,
    );
    expect(set).not.toHaveBeenCalled();
  });

  it('counts page reads per user in a one-minute window', async () => {
    incr.mockResolvedValue(3);

    await expect(linkPreview.countFetch('user-1')).resolves.toBe(3);
    expect(set).toHaveBeenCalledWith('link_preview_fetches:v1:user-1', '0', { ex: 60, nx: true });
    expect(incr).toHaveBeenCalledWith('link_preview_fetches:v1:user-1');

    redisAvailable = false;
    await expect(linkPreview.countFetch('user-1')).resolves.toBeUndefined();
  });

  it('reads live without Redis or when Redis fails', async () => {
    redisAvailable = false;
    const resolve = vi.fn().mockResolvedValue(null);
    await linkPreview.remember(URL, resolve);
    expect(resolve).toHaveBeenCalledTimes(1);
    await expect(
      linkPreview.remember(URL, () => Promise.reject(new Error('timeout'))),
    ).rejects.toBeInstanceOf(LinkPreviewUnavailableError);

    redisAvailable = true;
    get.mockRejectedValue(new Error('down'));
    set.mockRejectedValue(new Error('down'));
    await expect(linkPreview.remember(URL, resolve)).resolves.toBe(null);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
