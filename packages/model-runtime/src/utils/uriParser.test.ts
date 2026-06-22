import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseDataUri, validateExternalUrl } from './uriParser';

vi.mock('@lobechat/ssrf-safe-fetch', () => ({
  ssrfSafeFetch: vi.fn(),
}));

const mockHeadResponse = (headers: Record<string, string>, status = 200) =>
  new Response(null, { headers, status, statusText: status === 200 ? 'OK' : 'Error' });

describe('parseDataUri', () => {
  it('should parse a valid data URI', () => {
    const dataUri = 'data:image/png;base64,abc';
    const result = parseDataUri(dataUri);
    expect(result).toEqual({ base64: 'abc', mimeType: 'image/png', type: 'base64' });
  });

  it('should parse a valid URL', () => {
    const url = 'https://example.com/image.jpg';
    const result = parseDataUri(url);
    expect(result).toEqual({ base64: null, mimeType: null, type: 'url' });
  });

  it('should return null for an invalid input', () => {
    const invalidInput = 'invalid-data';
    const result = parseDataUri(invalidInput);
    expect(result).toEqual({ base64: null, mimeType: null, type: null });
  });

  it('should handle an empty input', () => {
    const emptyInput = '';
    const result = parseDataUri(emptyInput);
    expect(result).toEqual({ base64: null, mimeType: null, type: null });
  });

  it('should handle data URI with additional parameters before base64 marker', () => {
    const dataUri = 'data:image/png;charset=utf-8;base64,abc123';
    const result = parseDataUri(dataUri);
    expect(result).toEqual({
      base64: 'abc123',
      mimeType: 'image/png;charset=utf-8',
      type: 'base64',
    });
  });

  it('should handle data URI without MIME type', () => {
    const dataUri = 'data:;base64,abc';
    const result = parseDataUri(dataUri);
    // No MIME type between "data:" and ";base64," should fail
    expect(result).toEqual({ base64: null, mimeType: null, type: 'url' });
  });

  it('should handle data URI with empty base64 content', () => {
    const dataUri = 'data:image/png;base64,';
    const result = parseDataUri(dataUri);
    expect(result).toEqual({ base64: null, mimeType: null, type: 'url' });
  });

  it('should handle large data URIs without stack overflow', () => {
    // Simulate a ~26MB data URI similar to what Nano Banana 2 generates
    const largePadding = 'A'.repeat(1_000_000);
    const dataUri = `data:image/png;base64,${largePadding}`;
    const result = parseDataUri(dataUri);
    expect(result).toEqual({ base64: largePadding, mimeType: 'image/png', type: 'base64' });
  });
});

describe('validateExternalUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should accept a supported external URL with a valid content length', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      mockHeadResponse({ 'content-length': '1024', 'content-type': 'image/png' }),
    );

    const result = await validateExternalUrl('https://example.com/image.png');

    expect(result).toEqual({
      contentLength: 1024,
      contentType: 'image/png',
      isValid: true,
    });
  });

  it('should normalize image/jpg to image/jpeg', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      mockHeadResponse({ 'content-length': '1024', 'content-type': 'image/jpg' }),
    );

    const result = await validateExternalUrl('https://example.com/image.jpg');

    expect(result).toEqual({
      contentLength: 1024,
      contentType: 'image/jpeg',
      isValid: true,
    });
  });

  it('should accept supported external video URLs', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      mockHeadResponse({ 'content-length': '1024', 'content-type': 'video/mp4' }),
    );

    const result = await validateExternalUrl('https://example.com/video.mp4');

    expect(result).toEqual({
      contentLength: 1024,
      contentType: 'video/mp4',
      isValid: true,
    });
  });

  it('should accept supported external audio URLs', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      mockHeadResponse({ 'content-length': '1024', 'content-type': 'audio/wav' }),
    );

    const result = await validateExternalUrl('https://example.com/audio.wav');

    expect(result).toEqual({
      contentLength: 1024,
      contentType: 'audio/wav',
      isValid: true,
    });
  });

  it('should normalize audio/mpeg to audio/mp3 so mp3 URLs hand off as fileData', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      mockHeadResponse({ 'content-length': '1024', 'content-type': 'audio/mpeg' }),
    );

    const result = await validateExternalUrl('https://example.com/audio.mp3');

    expect(result).toEqual({
      contentLength: 1024,
      contentType: 'audio/mp3',
      isValid: true,
    });
  });

  it('should reject supported MIME types when Content-Length is missing', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      mockHeadResponse({ 'content-type': 'image/png' }),
    );

    const result = await validateExternalUrl('https://example.com/image.png');

    expect(result).toEqual({
      contentLength: 0,
      contentType: 'image/png',
      isValid: false,
      reason: 'Missing or invalid Content-Length header',
    });
  });

  it('should reject supported MIME types when Content-Length is invalid', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      mockHeadResponse({ 'content-length': 'unknown', 'content-type': 'image/png' }),
    );

    const result = await validateExternalUrl('https://example.com/image.png');

    expect(result).toEqual({
      contentLength: 0,
      contentType: 'image/png',
      isValid: false,
      reason: 'Missing or invalid Content-Length header',
    });
  });

  it('should reject unsupported MIME types', async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      mockHeadResponse({ 'content-length': '1024', 'content-type': 'image/svg+xml' }),
    );

    const result = await validateExternalUrl('https://example.com/image.svg');

    expect(result).toEqual({
      contentLength: 1024,
      contentType: 'image/svg+xml',
      isValid: false,
      reason: 'Unsupported content type: image/svg+xml',
    });
  });

  it('should reject files larger than the external URL limit', async () => {
    const tooLarge = 101 * 1024 * 1024;
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      mockHeadResponse({ 'content-length': String(tooLarge), 'content-type': 'image/png' }),
    );

    const result = await validateExternalUrl('https://example.com/large.png');

    expect(result).toEqual({
      contentLength: tooLarge,
      contentType: 'image/png',
      isTooLarge: true,
      isValid: false,
      reason: `File too large: ${tooLarge} bytes (max ${100 * 1024 * 1024} bytes)`,
    });
  });
});
