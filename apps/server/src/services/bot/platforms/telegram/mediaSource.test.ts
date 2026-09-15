import { describe, expect, it } from 'vitest';

import { resolveTelegramSource, telegramMediaTypeFor } from './mediaSource';

describe('Telegram media sources', () => {
  it('keeps image URLs as remote Rich Message media', async () => {
    await expect(
      resolveTelegramSource({ fetchUrl: 'https://cdn.example/image.png', type: 'image' }, 0),
    ).resolves.toEqual({ url: 'https://cdn.example/image.png' });
  });

  it('materializes base64 attachments for multipart Rich Messages', async () => {
    const source = await resolveTelegramSource(
      {
        data: Buffer.from('document').toString('base64'),
        mimeType: 'application/pdf',
        name: 'report.pdf',
        type: 'file',
      },
      0,
    );

    expect(source).toEqual({
      buffer: Buffer.from('document'),
      filename: 'report.pdf',
      mimeType: 'application/pdf',
    });
  });

  it.each([
    {
      attachment: { mimeType: 'audio/x-m4a', name: 'recording.m4a', type: 'audio' as const },
      expected: 'audio',
      scenario: 'M4A audio',
    },
    {
      attachment: {
        mimeType: 'application/octet-stream',
        name: 'recording.mp3',
        type: 'audio' as const,
      },
      expected: 'audio',
      scenario: 'generic MIME with an MP3 extension',
    },
    {
      attachment: { name: 'recording.MP3', type: 'audio' as const },
      expected: 'audio',
      scenario: 'uppercase MP3 extension',
    },
    {
      attachment: { mimeType: 'Audio/MPEG; charset=binary', type: 'audio' as const },
      expected: 'audio',
      scenario: 'case-insensitive MIME with parameters',
    },
    {
      attachment: { mimeType: 'audio/wav', name: 'recording.wav', type: 'audio' as const },
      expected: 'document',
      scenario: 'WAV audio',
    },
    {
      attachment: { mimeType: 'audio/flac', name: 'recording.flac', type: 'audio' as const },
      expected: 'document',
      scenario: 'FLAC audio',
    },
  ])('maps $scenario to $expected Rich media', ({ attachment, expected }) => {
    expect(telegramMediaTypeFor(attachment)).toBe(expected);
  });

  it('maps generic files to document Rich media', () => {
    expect(telegramMediaTypeFor({ name: 'report.pdf', type: 'file' })).toBe('document');
  });
});
