import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { linkPreview } from './linkPreview';

const { get, set } = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
let redisAvailable = true;
vi.mock('./client', () => ({
  getRedisServiceClient: async () => (redisAvailable ? { get, set } : null),
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

  it('retries a failed fetch after five minutes instead of an hour', async () => {
    const resolve = vi.fn().mockRejectedValue(new Error('timeout'));

    await expect(linkPreview.remember(URL, resolve)).resolves.toBe(null);
    expect(set).toHaveBeenCalledWith(KEY, JSON.stringify({ preview: null }), {
      px: 5 * 60 * 1000,
    });
  });

  it('reads live without Redis or when Redis fails', async () => {
    redisAvailable = false;
    const resolve = vi.fn().mockResolvedValue(null);
    await linkPreview.remember(URL, resolve);
    expect(resolve).toHaveBeenCalledTimes(1);

    redisAvailable = true;
    get.mockRejectedValue(new Error('down'));
    set.mockRejectedValue(new Error('down'));
    await expect(linkPreview.remember(URL, resolve)).resolves.toBe(null);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
