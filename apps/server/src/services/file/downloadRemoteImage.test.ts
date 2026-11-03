// @vitest-environment node
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadRemoteImage, MAX_REMOTE_IMAGE_BYTES } from './downloadRemoteImage';

vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: vi.fn() }));

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);

describe('downloadRemoteImage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('downloads through the SSRF guard and uses detected image content', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValue(
      new Response(png, { headers: { 'content-type': 'application/octet-stream' } }),
    );
    await expect(downloadRemoteImage('https://cdn.discordapp.com/image')).resolves.toEqual({
      buffer: png,
      extension: 'png',
      mimeType: 'image/png',
    });
    expect(ssrfSafeFetch).toHaveBeenCalledWith(
      'https://cdn.discordapp.com/image',
      {
        signal: expect.any(AbortSignal),
      },
      {
        maxContentLength: MAX_REMOTE_IMAGE_BYTES + 1,
      },
    );
  });

  it.each([
    'file:///etc/passwd',
    'data:image/png;base64,AA==',
    'https://user:pass@example.com/image',
  ])('rejects unsupported URLs: %s', async (url) => {
    await expect(downloadRemoteImage(url)).rejects.toThrow('Invalid image URL');
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
  });

  it('propagates SSRF rejection without uploading', async () => {
    vi.mocked(ssrfSafeFetch).mockRejectedValue(new Error('Blocked private IP'));
    await expect(downloadRemoteImage('http://127.0.0.1/image')).rejects.toThrow(
      'Blocked private IP',
    );
  });

  it('rejects failed HTTP responses even with image bytes', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValue(new Response(png, { status: 404 }));
    await expect(downloadRemoteImage('https://example.com/image')).rejects.toThrow(
      'Failed to download image',
    );
  });

  it('rejects HTML masquerading as an image', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValue(
      new Response('<html>not an image</html>', { headers: { 'content-type': 'image/png' } }),
    );
    await expect(downloadRemoteImage('https://example.com/image')).rejects.toThrow(
      'Unsupported image content',
    );
  });

  it('rejects oversized declared bodies', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValue(
      new Response(png, { headers: { 'content-length': String(MAX_REMOTE_IMAGE_BYTES + 1) } }),
    );
    await expect(downloadRemoteImage('https://example.com/image')).rejects.toThrow(
      'download limit',
    );
  });

  it('caps streamed bodies even without a content length', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_REMOTE_IMAGE_BYTES + 1));
      },
      cancel,
    });
    vi.mocked(ssrfSafeFetch).mockResolvedValue(new Response(stream));
    await expect(downloadRemoteImage('https://example.com/image')).rejects.toThrow(
      'download limit',
    );
    expect(cancel).toHaveBeenCalled();
  });
});
