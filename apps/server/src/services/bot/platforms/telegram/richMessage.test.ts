import { describe, expect, it } from 'vitest';

import { prepareTelegramRichMessage, truncateTelegramRichMarkdown } from './richMessage';

describe('prepareTelegramRichMessage', () => {
  it('preserves rich markdown and embeds URL media with stable ids', async () => {
    const prepared = await prepareTelegramRichMessage(
      '# Report\n\n| A | B |\n| - | - |\n| 1 | $x^2$ |',
      [
        { fetchUrl: 'https://cdn.example/image.png', name: 'Chart', type: 'image' },
        {
          fetchUrl: 'https://cdn.example/video.mp4',
          mimeType: 'video/mp4',
          name: 'Demo',
          type: 'video',
        },
      ],
    );

    expect(prepared.uploads).toEqual([]);
    expect(prepared.richMessage.markdown).toContain('| 1 | $x^2$ |');
    expect(prepared.richMessage.markdown).toContain('tg://photo?id=media_0');
    expect(prepared.richMessage.markdown).toContain('tg://video?id=media_1');
    expect(prepared.richMessage.media).toEqual([
      {
        id: 'media_0',
        media: { media: 'https://cdn.example/image.png', type: 'photo' },
      },
      {
        id: 'media_1',
        media: {
          media: 'https://cdn.example/video.mp4',
          supports_streaming: true,
          type: 'video',
        },
      },
    ]);
  });

  it('uses multipart attach fields for base64 media', async () => {
    const prepared = await prepareTelegramRichMessage('File', [
      {
        data: Buffer.from('pdf').toString('base64'),
        mimeType: 'application/pdf',
        name: 'report.pdf',
        type: 'file',
      },
    ]);

    expect(prepared.richMessage.media?.[0]).toEqual({
      id: 'media_0',
      media: { media: 'attach://file_0', type: 'document' },
    });
    expect(prepared.uploads).toEqual([
      {
        buffer: Buffer.from('pdf'),
        fieldName: 'file_0',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
      },
    ]);
  });

  it('closes open markdown when truncating', () => {
    const result = truncateTelegramRichMarkdown(`\`\`\`ts\n${'x'.repeat(40_000)}`);
    expect(Array.from(result).length).toBeLessThanOrEqual(32_768);
    expect(result).toContain('```');
    expect(result.endsWith('...')).toBe(true);
  });
});
