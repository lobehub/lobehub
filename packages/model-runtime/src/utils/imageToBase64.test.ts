// @vitest-environment node
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { imageUrlToBase64 } from './imageToBase64';

vi.mock('@lobechat/ssrf-safe-fetch', () => ({
  ssrfSafeFetch: vi.fn(),
}));

describe('imageUrlToBase64', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should cap the server-side download itself, not only the buffered result', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));

    await imageUrlToBase64('https://example.com/a.bin', { maxBytes: 3 });

    // One byte over the limit is read so an oversized body is detected instead of truncated.
    expect(ssrfSafeFetch).toHaveBeenCalledWith('https://example.com/a.bin', undefined, {
      maxContentLength: 4,
    });
  });

  it('should reject a body longer than maxBytes without content-length', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4])));

    await expect(imageUrlToBase64('https://example.com/a.bin', { maxBytes: 3 })).rejects.toThrow(
      RangeError,
    );
  });

  it('should pass the abort signal to the download', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValue(new Response(new Uint8Array([1])));
    const signal = AbortSignal.timeout(1000);

    await imageUrlToBase64('https://example.com/a.bin', { signal });

    expect(ssrfSafeFetch).toHaveBeenCalledWith('https://example.com/a.bin', { signal }, undefined);
  });
});
