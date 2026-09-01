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

  it('uses document media for unsupported playable-audio formats', () => {
    expect(telegramMediaTypeFor({ mimeType: 'audio/ogg', type: 'audio' })).toBe('document');
    expect(telegramMediaTypeFor({ name: 'track.mp3', type: 'audio' })).toBe('audio');
  });
});
