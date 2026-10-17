import { imageUrlToBase64 } from '@lobechat/utils';
import type { Buffer } from 'buffer.js';

/**
 * Short-lived in-process cache for downloaded image/video generation reference
 * images.
 *
 * Providers that cannot take a URL download each reference image and re-encode
 * it (base64 or multipart File). Without a cache, the same image is downloaded
 * again for every RouterRuntime fallback attempt within one request. Batch
 * siblings each run as a separate async HTTP request, so they share downloads
 * only when they land on the same server instance; serverless deployments may
 * spread them across instances. Those repeats happen within seconds, so a
 * one-minute TTL covers them while limiting staleness for arbitrary URLs whose
 * content may change (for example, an external URL passed by an agent tool).
 *
 * Only successful downloads of `http(s)` URLs are cached; concurrent requests
 * for the same URL share one in-flight download.
 */
interface CacheEntry {
  expiresAt: number;
  promise: Promise<unknown>;
  /** Byte size once the download settles; 0 while in flight. */
  size: number;
}

export interface DownloadCacheOptions {
  /** Values larger than this are returned but not kept. */
  maxEntryBytes: number;
  /** Total bytes kept across settled entries; least recently used entries are evicted first. */
  maxTotalBytes: number;
  ttlMs: number;
}

/**
 * URL-keyed download cache sharing one byte budget across value kinds. Callers
 * must namespace keys per value kind so one key always maps to one value type.
 */
export class DownloadCache {
  private readonly entries = new Map<string, CacheEntry>();
  private totalBytes = 0;

  constructor(
    private readonly options: DownloadCacheOptions,
    private readonly now: () => number = Date.now,
  ) {}

  get size() {
    return this.entries.size;
  }

  get bytes() {
    return this.totalBytes;
  }

  clear() {
    this.entries.clear();
    this.totalBytes = 0;
  }

  async get<T>(key: string, loader: () => Promise<T>, sizeOf: (value: T) => number): Promise<T> {
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.expiresAt > this.now()) {
        // Refresh LRU order: Map iteration follows insertion order.
        this.entries.delete(key);
        this.entries.set(key, existing);
        return existing.promise as Promise<T>;
      }
      this.remove(key, existing);
    }

    const promise = loader();
    const entry: CacheEntry = {
      expiresAt: this.now() + this.options.ttlMs,
      promise,
      size: 0,
    };
    this.entries.set(key, entry);

    try {
      const value = await promise;
      // The entry may have been cleared or replaced while the download was in flight.
      if (this.entries.get(key) !== entry) return value;

      const size = sizeOf(value);
      if (size > this.options.maxEntryBytes) {
        this.entries.delete(key);
        return value;
      }

      entry.size = size;
      this.totalBytes += size;
      this.evictOverflow();
      return value;
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    }
  }

  private remove(key: string, entry: CacheEntry) {
    this.entries.delete(key);
    this.totalBytes -= entry.size;
  }

  private evictOverflow() {
    for (const [key, entry] of this.entries) {
      if (this.totalBytes <= this.options.maxTotalBytes) return;
      // In-flight entries have no size yet and are kept so their waiters still dedupe.
      if (entry.size > 0) this.remove(key, entry);
    }
  }
}

const MB = 1024 * 1024;

const isRemoteUrl = (url: string) => /^https?:\/\//i.test(url);

const referenceImageCache = new DownloadCache({
  maxEntryBytes: 20 * MB,
  maxTotalBytes: 64 * MB,
  ttlMs: 60 * 1000,
});

export interface ReferenceImageBytes {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Cached `imageUrlToBase64` for generation reference images. Data URLs and other
 * non-HTTP inputs bypass the cache.
 */
export const referenceImageUrlToBase64 = (imageUrl: string) =>
  isRemoteUrl(imageUrl)
    ? referenceImageCache.get(
        `base64:${imageUrl}`,
        () => imageUrlToBase64(imageUrl),
        (value) => value.base64.length,
      )
    : imageUrlToBase64(imageUrl);

/**
 * Cached raw download of a remote generation reference image. Callers must not
 * mutate the returned buffer because it is shared with later cache hits.
 */
export const fetchReferenceImageBytes = (
  imageUrl: string,
  fetcher: (url: string) => Promise<ReferenceImageBytes>,
) =>
  isRemoteUrl(imageUrl)
    ? referenceImageCache.get(
        `bytes:${imageUrl}`,
        () => fetcher(imageUrl),
        (value) => value.buffer.byteLength,
      )
    : fetcher(imageUrl);

/** Test helper: drop every cached reference image. */
export const clearReferenceImageCache = () => {
  referenceImageCache.clear();
};
