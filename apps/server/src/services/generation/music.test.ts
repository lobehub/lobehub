import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileService } from '@/server/services/file';

import { MusicGenerationService, resolveAudioFormat } from './music';

vi.mock('@/server/services/file');

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@lobechat/ssrf-safe-fetch', () => ({
  ssrfSafeFetch: (...args: unknown[]) => fetchMock(...args),
}));

describe('resolveAudioFormat', () => {
  it.each([
    ['audio/mpeg', undefined, { ext: '.mp3', mimeType: 'audio/mpeg' }],
    ['audio/wav; charset=binary', undefined, { ext: '.wav', mimeType: 'audio/wav' }],
    [
      'application/octet-stream',
      'https://cdn.x/a.flac?sig=1',
      { ext: '.flac', mimeType: 'audio/flac' },
    ],
    [undefined, 'https://cdn.x/song', { ext: '.mp3', mimeType: 'audio/mpeg' }],
  ])('maps %s / %s', (contentType, url, expected) => {
    expect(resolveAudioFormat(contentType, url)).toEqual(expected);
  });
});

describe('MusicGenerationService.processTrack', () => {
  let uploadBuffer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    uploadBuffer = vi.fn(async (key: string) => ({ key }));
    vi.mocked(FileService).mockImplementation(function () {
      return { uploadBuffer } as any;
    });
  });

  afterEach(() => {
    MusicGenerationService.MAX_AUDIO_SIZE = 100 * 1024 * 1024;
  });

  const service = () => new MusicGenerationService({} as any, 'user-1');

  it('uploads inline audio bytes without downloading', async () => {
    const bytes = new TextEncoder().encode('RIFF....WAVE').buffer;

    const result = await service().processTrack({
      audio: bytes as ArrayBuffer,
      contentType: 'audio/wav',
      duration: 31.5,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      audioKey: expect.stringMatching(/^generations\/music\/.+_audio\.wav$/),
      coverKey: undefined,
      duration: 31.5,
      fileSize: 12,
      mimeType: 'audio/wav',
    });
    expect(result.fileHash).toMatch(/^[\da-f]{64}$/);
    expect(uploadBuffer).toHaveBeenCalledWith(result.audioKey, expect.any(Buffer), 'audio/wav');
  });

  it('downloads a hosted track and its cover', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([9]), { headers: { 'content-type': 'image/png' } }),
      );

    const result = await service().processTrack({
      audioUrl: 'https://cdn.example.com/a.mp3',
      imageUrl: 'https://cdn.example.com/a.png',
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://cdn.example.com/a.mp3',
      'https://cdn.example.com/a.png',
    ]);
    expect(result.audioKey).toMatch(/_audio\.mp3$/);
    expect(result.coverKey).toMatch(/_cover\.png$/);
    expect(result.fileSize).toBe(3);
    expect(uploadBuffer).toHaveBeenCalledTimes(2);
  });

  it('keeps the song when only the cover download fails', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mpeg' } }),
      )
      .mockResolvedValueOnce(new Response('gone', { status: 404, statusText: 'Not Found' }));

    const result = await service().processTrack({
      audioUrl: 'https://cdn.example.com/a.mp3',
      imageUrl: 'https://cdn.example.com/a.jpg',
    });

    expect(result.coverKey).toBeUndefined();
    expect(uploadBuffer).toHaveBeenCalledTimes(1);
  });

  it('fails when the audio download fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('expired', { status: 403, statusText: 'Forbidden' }),
    );

    await expect(
      service().processTrack({ audioUrl: 'https://cdn.example.com/expired.mp3' }),
    ).rejects.toThrow('Failed to download https://cdn.example.com/expired.mp3: 403 Forbidden');
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('stops a download without content-length once it passes the size cap', async () => {
    MusicGenerationService.MAX_AUDIO_SIZE = 4;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(body));

    await expect(
      service().processTrack({ audioUrl: 'https://cdn.example.com/stream.mp3' }),
    ).rejects.toThrow('File too large: exceeded 4 bytes during download');
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('rejects a track without audio and an oversized download', async () => {
    await expect(service().processTrack({ title: 'x' })).rejects.toThrow(
      'The provider returned a track without audio',
    );

    fetchMock.mockResolvedValueOnce(
      new Response('x', {
        headers: { 'content-length': String(MusicGenerationService.MAX_AUDIO_SIZE + 1) },
      }),
    );
    await expect(
      service().processTrack({ audioUrl: 'https://cdn.example.com/huge.wav' }),
    ).rejects.toThrow(/File too large/);
  });
});
