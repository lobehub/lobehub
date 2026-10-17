import { imageUrlToBase64 } from '@lobechat/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearReferenceImageCache,
  DownloadCache,
  fetchReferenceImageBytes,
  referenceImageUrlToBase64,
} from './referenceImageCache';

vi.mock('@lobechat/utils', () => ({ imageUrlToBase64: vi.fn() }));

const createCache = (now = () => 0) => {
  const cache = new DownloadCache({ maxEntryBytes: 10, maxTotalBytes: 12, ttlMs: 1000 }, now);
  return {
    get bytes() {
      return cache.bytes;
    },
    get: (key: string, loader: () => Promise<string>) =>
      cache.get(key, loader, (value) => value.length),
    get size() {
      return cache.size;
    },
  };
};

describe('DownloadCache', () => {
  it('reuses a settled download for the same key', async () => {
    const cache = createCache();
    const loader = vi.fn().mockResolvedValue('abc');

    await expect(cache.get('a', loader)).resolves.toBe('abc');
    await expect(cache.get('a', loader)).resolves.toBe('abc');

    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.bytes).toBe(3);
  });

  it('shares one in-flight download across concurrent callers', async () => {
    const cache = createCache();
    let resolve!: (value: string) => void;
    const loader = vi.fn(() => new Promise<string>((r) => (resolve = r)));

    const first = cache.get('a', loader);
    const second = cache.get('a', loader);
    resolve('abc');

    await expect(Promise.all([first, second])).resolves.toEqual(['abc', 'abc']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('does not cache failed downloads', async () => {
    const cache = createCache();
    const loader = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('abc');

    await expect(cache.get('a', loader)).rejects.toThrow('boom');
    await expect(cache.get('a', loader)).resolves.toBe('abc');

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('downloads again after the TTL expires', async () => {
    let now = 0;
    const cache = createCache(() => now);
    const loader = vi.fn().mockResolvedValueOnce('old').mockResolvedValue('new');

    await cache.get('a', loader);
    now = 1001;

    await expect(cache.get('a', loader)).resolves.toBe('new');
    expect(cache.bytes).toBe(3);
  });

  it('returns but does not keep values over the entry limit', async () => {
    const cache = createCache();
    const loader = vi.fn().mockResolvedValue('x'.repeat(11));

    await cache.get('a', loader);
    await cache.get('a', loader);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it('evicts least recently used entries past the total limit', async () => {
    const cache = createCache();

    await cache.get('a', async () => 'aaaaa');
    await cache.get('b', async () => 'bbbbb');
    // Touch `a` so `b` becomes the least recently used entry.
    await cache.get('a', async () => 'unused');
    await cache.get('c', async () => 'ccccc');

    const reload = vi.fn().mockResolvedValue('bbbbb');
    await cache.get('b', reload);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(cache.bytes).toBeLessThanOrEqual(12);
  });
});

describe('reference image helpers', () => {
  beforeEach(() => {
    clearReferenceImageCache();
    vi.mocked(imageUrlToBase64).mockReset();
  });

  it('caches base64 conversions of remote URLs', async () => {
    vi.mocked(imageUrlToBase64).mockResolvedValue({ base64: 'AAAA', mimeType: 'image/png' });

    await referenceImageUrlToBase64('https://cdn.example.com/a.png');
    await referenceImageUrlToBase64('https://cdn.example.com/a.png');

    expect(imageUrlToBase64).toHaveBeenCalledTimes(1);
  });

  it('bypasses the cache for data URLs', async () => {
    vi.mocked(imageUrlToBase64).mockResolvedValue({ base64: 'AAAA', mimeType: 'image/png' });

    await referenceImageUrlToBase64('data:image/png;base64,AAAA');
    await referenceImageUrlToBase64('data:image/png;base64,AAAA');

    expect(imageUrlToBase64).toHaveBeenCalledTimes(2);
  });

  it('caches raw downloads of remote URLs', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({ buffer: Buffer.from('img'), mimeType: 'image/png' });

    await fetchReferenceImageBytes('https://cdn.example.com/a.png', fetcher);
    await fetchReferenceImageBytes('https://cdn.example.com/a.png', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps base64 and raw downloads of the same URL apart', async () => {
    vi.mocked(imageUrlToBase64).mockResolvedValue({ base64: 'AAAA', mimeType: 'image/png' });
    const bytes = { buffer: Buffer.from('img'), mimeType: 'image/png' };

    await expect(referenceImageUrlToBase64('https://cdn.example.com/a.png')).resolves.toEqual({
      base64: 'AAAA',
      mimeType: 'image/png',
    });
    await expect(
      fetchReferenceImageBytes('https://cdn.example.com/a.png', async () => bytes),
    ).resolves.toBe(bytes);
  });
});
