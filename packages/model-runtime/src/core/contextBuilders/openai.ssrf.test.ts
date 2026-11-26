// @vitest-environment node
import type * as SSRFSafeFetchModule from '@lobechat/ssrf-safe-fetch';
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReferenceImageCache } from '../../utils/referenceImageCache';
import { convertImageUrlToFile } from './openai';

// Wrap the real ssrfSafeFetch so call-through can be asserted while the real
// request-filtering policy still applies.
vi.mock('@lobechat/ssrf-safe-fetch', async (importOriginal) => {
  const mod = await importOriginal<typeof SSRFSafeFetchModule>();
  return { ...mod, ssrfSafeFetch: vi.fn(mod.ssrfSafeFetch) };
});

/**
 * `image.createImage` forwards user-supplied `imageUrls` to
 * `convertImageUrlToFile`, which downloads them server-side. The download must
 * go through the SSRF policy; a raw fetch would reach intranet and instance
 * metadata endpoints (T-07).
 */
describe('convertImageUrlToFile SSRF boundary', () => {
  beforeEach(() => {
    vi.stubEnv('SSRF_ALLOW_IP_ADDRESS_LIST', undefined);
    vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', undefined);
    // A stubbed native fetch keeps the unguarded path deterministic so this
    // suite fails fast if the SSRF guard is ever bypassed.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1]))));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    clearReferenceImageCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/image.png',
    'http://127.0.0.1:8188/image.png',
    'http://10.0.0.1/image.png',
    'http://192.168.1.1/image.png',
    'http://172.16.0.1/image.png',
    'http://[::1]/image.png',
  ])('blocks the reference image download to %s', async (url) => {
    await expect(convertImageUrlToFile(url)).rejects.toThrow(/SSRF blocked/);

    expect(ssrfSafeFetch).toHaveBeenCalledWith(url, undefined, undefined);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('routes remote image downloads through ssrfSafeFetch', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/png' },
      }),
    );

    const result = await convertImageUrlToFile('https://example.com/reference.png');

    expect(ssrfSafeFetch).toHaveBeenCalledWith(
      'https://example.com/reference.png',
      undefined,
      undefined,
    );
    expect(result).toHaveProperty('type', 'image/png');
  });
});
