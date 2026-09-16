import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clipTelegramRichBlocks,
  prepareTelegramRichMessage,
  TELEGRAM_RICH_BLOCK_LIMIT,
  TELEGRAM_RICH_MEDIA_LIMIT,
  TELEGRAM_RICH_MESSAGE_LIMIT,
  TELEGRAM_RICH_UPLOAD_BUDGET,
  truncateTelegramRichMarkdown,
} from './richMessage';

const loadAttachmentBufferMock = vi.hoisted(() => vi.fn());

vi.mock('../loadAttachmentBuffer', () => ({
  loadAttachmentBuffer: loadAttachmentBufferMock,
  MAX_IN_MEMORY_ATTACHMENT_BYTES: 50 * 1024 * 1024,
}));

describe('prepareTelegramRichMessage', () => {
  beforeEach(() => {
    loadAttachmentBufferMock.mockClear();
    loadAttachmentBufferMock.mockImplementation(
      async (attachment: { data?: string; fetchUrl?: string }) => {
        if (attachment.data) return Buffer.from(attachment.data, 'base64');
        if (attachment.fetchUrl) return Buffer.from('downloaded');
        return undefined;
      },
    );
  });

  it('preserves rich markdown and uses Telegram-compatible media sources', async () => {
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
          media: 'attach://file_1',
          supports_streaming: true,
          type: 'video',
        },
      },
    ]);
    expect(prepared.uploads).toEqual([
      {
        buffer: Buffer.from('downloaded'),
        fieldName: 'file_1',
        filename: 'Demo',
        mimeType: 'video/mp4',
      },
    ]);
  });

  it('embeds files as document Rich media', async () => {
    const prepared = await prepareTelegramRichMessage('File', [
      {
        data: Buffer.from('pdf').toString('base64'),
        mimeType: 'application/pdf',
        name: 'report.pdf',
        type: 'file',
      },
    ]);

    expect(prepared.richMessage.markdown).toContain('![](tg://document?id=media_0)');
    expect(prepared.richMessage.markdown).not.toContain('"report.pdf"');
    expect(prepared.richMessage.media).toEqual([
      {
        id: 'media_0',
        media: { media: 'attach://file_0', type: 'document' },
      },
    ]);
    expect(prepared.uploads).toEqual([
      {
        buffer: Buffer.from('pdf'),
        fieldName: 'file_0',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
      },
    ]);
  });

  it('keeps Guest Query documents as download links', async () => {
    const prepared = await prepareTelegramRichMessage(
      'File',
      [
        {
          fetchUrl: 'https://cloud.example/f/file-id',
          mimeType: 'application/pdf',
          name: 'report.pdf',
          type: 'file',
        },
      ],
      { linksOnly: true },
    );

    expect(prepared.richMessage.markdown).toBe(
      'File\n\n📎 [report.pdf](https://cloud.example/f/file-id)',
    );
    expect(prepared.richMessage.media).toBeUndefined();
    expect(prepared.uploads).toEqual([]);
    expect(loadAttachmentBufferMock).not.toHaveBeenCalled();
  });

  it('closes open markdown when truncating', () => {
    const result = truncateTelegramRichMarkdown(`\`\`\`ts\n${'x'.repeat(40_000)}`);
    expect(Array.from(result).length).toBeLessThanOrEqual(32_768);
    expect(result).toContain('```');
    expect(result.endsWith('...')).toBe(true);
  });

  it('reserves room for complete media references when truncating long text', async () => {
    const prepared = await prepareTelegramRichMessage('x'.repeat(40_000), [
      { fetchUrl: 'https://cdn.example/image.png', name: 'Chart', type: 'image' },
      { data: Buffer.from('pdf').toString('base64'), name: 'Report', type: 'file' },
    ]);

    expect(Array.from(prepared.richMessage.markdown).length).toBeLessThanOrEqual(32_768);
    expect(prepared.richMessage.markdown).toContain('![](tg://photo?id=media_0 "Chart")');
    expect(prepared.richMessage.markdown).toContain('![](tg://document?id=media_1)');
  });

  it('does not register media whose complete reference cannot fit', async () => {
    const prepared = await prepareTelegramRichMessage('', [
      {
        fetchUrl: 'https://cdn.example/image.png',
        name: 'x'.repeat(TELEGRAM_RICH_MESSAGE_LIMIT),
        type: 'image',
      },
    ]);

    expect(Array.from(prepared.richMessage.markdown).length).toBeLessThanOrEqual(
      TELEGRAM_RICH_MESSAGE_LIMIT,
    );
    expect(prepared.richMessage.markdown).toContain('could not be delivered.');
    expect(prepared.droppedAttachments).toEqual(['x'.repeat(TELEGRAM_RICH_MESSAGE_LIMIT)]);
    expect(prepared.uploads).toEqual([]);
    expect(loadAttachmentBufferMock).not.toHaveBeenCalled();
  });

  it('returns an empty string when the truncation budget is zero', () => {
    expect(truncateTelegramRichMarkdown('hello', 0)).toBe('');
  });

  it('clips extra Rich Message blocks before the character limit is reached', () => {
    const markdown = Array.from(
      { length: TELEGRAM_RICH_BLOCK_LIMIT + 20 },
      (_, index) => `paragraph ${index}`,
    ).join('\n\n');
    const clipped = clipTelegramRichBlocks(markdown);
    expect(clipped).toContain('paragraph 0');
    expect(clipped).toContain(`paragraph ${TELEGRAM_RICH_BLOCK_LIMIT - 1}`);
    expect(clipped).not.toContain(`paragraph ${TELEGRAM_RICH_BLOCK_LIMIT}`);
  });

  it('does not treat fenced code lines as Rich Message blocks', () => {
    const markdown = [
      '```',
      ...Array.from({ length: 80 }, (_, index) => `- item ${index}`),
      '```',
    ].join('\n');
    expect(clipTelegramRichBlocks(markdown)).toBe(markdown);
  });

  it("clips table columns to Telegram's limit", () => {
    const cells = Array.from({ length: 21 }, (_, index) => `c${index}`);
    const markdown = `| ${cells.join(' | ')} |\n| ${cells.map(() => '-').join(' | ')} |\n| ${cells.join(' | ')} |`;
    const clipped = clipTelegramRichBlocks(markdown);
    expect(clipped).toContain('c0');
    expect(clipped).toContain('c19');
    expect(clipped).not.toContain('c20');
  });

  it('keeps visible text while neutralizing raw HTML blocks that cannot be counted reliably', () => {
    const markdown = [
      'hello',
      '<details><details><p>nested</p></details></details>',
      '<table><tr><td>a</td><td>b</td></tr></table>',
      'world',
    ].join('\n\n');
    const clipped = clipTelegramRichBlocks(markdown);
    expect(clipped).toContain('hello');
    expect(clipped).toContain('world');
    expect(clipped).toContain('nested');
    expect(clipped).toContain('a');
    expect(clipped).toContain('b');
    expect(clipped).not.toContain('<details');
    expect(clipped).not.toContain('<table');
  });

  it('keeps Telegram inline HTML tags', () => {
    const markdown = 'See <u>underlined</u> and H<sub>2</sub>O';
    expect(clipTelegramRichBlocks(markdown)).toContain('<u>underlined</u>');
    expect(clipTelegramRichBlocks(markdown)).toContain('<sub>2</sub>');
  });

  it('does not silently empty a block-HTML-only reply', async () => {
    const prepared = await prepareTelegramRichMessage(
      '<details><summary>only html</summary>secret</details>',
    );
    expect(prepared.richMessage.markdown).toContain('only html');
    expect(prepared.richMessage.markdown).toContain('secret');
    expect(prepared.richMessage.markdown).not.toContain('<details');
  });

  it('caps aggregate multipart bytes and degrades asymmetrically by URL availability', async () => {
    loadAttachmentBufferMock.mockImplementation(async (attachment: { name?: string }) =>
      Buffer.alloc(attachment.name === 'first.bin' ? TELEGRAM_RICH_UPLOAD_BUDGET - 1 : 2),
    );

    const prepared = await prepareTelegramRichMessage('Body', [
      { data: 'ignored', name: 'first.bin', type: 'file' },
      { fetchUrl: 'https://cdn.example/second.bin', name: 'second.bin', type: 'file' },
      { data: 'ignored', name: 'third.bin', type: 'file' },
    ]);

    expect(prepared.uploads).toHaveLength(1);
    expect(prepared.uploads[0]!.buffer.byteLength).toBe(TELEGRAM_RICH_UPLOAD_BUDGET - 1);
    expect(prepared.richMessage.markdown).toContain('[second.bin](https://cdn.example/second.bin)');
    expect(prepared.richMessage.markdown).toContain('third.bin could not be delivered.');
    expect(prepared.droppedAttachments).toEqual(['third.bin']);
  });

  it('counts body tg media before admitting attachment media', async () => {
    const bodyMedia = Array.from(
      { length: TELEGRAM_RICH_MEDIA_LIMIT - 1 },
      (_, index) => `![](tg://photo?id=body_${index})`,
    ).join(' ');
    const prepared = await prepareTelegramRichMessage(bodyMedia, [
      { fetchUrl: 'https://cdn.example/accepted.png', name: 'accepted.png', type: 'image' },
      { fetchUrl: 'https://cdn.example/linked.png', name: 'linked.png', type: 'image' },
    ]);

    expect(prepared.richMessage.media).toHaveLength(1);
    expect(prepared.richMessage.markdown.match(/tg:\/\/photo/g)).toHaveLength(
      TELEGRAM_RICH_MEDIA_LIMIT,
    );
    expect(prepared.richMessage.markdown).toContain('[linked.png](https://cdn.example/linked.png)');
  });

  it('clips body tg media to the Rich Message media limit', async () => {
    const bodyMedia = Array.from(
      { length: TELEGRAM_RICH_MEDIA_LIMIT + 1 },
      (_, index) => `![](tg://photo?id=body_${index})`,
    ).join('\n\n');

    const prepared = await prepareTelegramRichMessage(bodyMedia);

    expect(prepared.richMessage.markdown.match(/tg:\/\/photo/g)).toHaveLength(
      TELEGRAM_RICH_MEDIA_LIMIT,
    );
    expect(prepared.richMessage.markdown).not.toContain('body_50');
  });

  it('notes unsourced attachments instead of dropping them silently', async () => {
    const prepared = await prepareTelegramRichMessage("Here's the report", [
      { name: 'report.pdf', type: 'file' },
    ]);

    expect(prepared.droppedAttachments).toEqual(['report.pdf']);
    expect(prepared.richMessage.markdown).toContain("Here's the report");
    expect(prepared.richMessage.markdown).toContain('report.pdf could not be delivered.');
    expect(prepared.richMessage.media).toBeUndefined();
  });

  it('keeps attachments past the Rich media cap as download links', async () => {
    const attachments = Array.from({ length: TELEGRAM_RICH_MEDIA_LIMIT + 1 }, (_, index) => ({
      fetchUrl: `https://cdn.example/${index}.png`,
      name: `pic-${index}.png`,
      type: 'image' as const,
    }));
    const prepared = await prepareTelegramRichMessage('Photos', attachments);

    expect(prepared.richMessage.media).toHaveLength(TELEGRAM_RICH_MEDIA_LIMIT);
    expect(prepared.richMessage.markdown).toContain(
      `[pic-${TELEGRAM_RICH_MEDIA_LIMIT}.png](https://cdn.example/${TELEGRAM_RICH_MEDIA_LIMIT}.png)`,
    );
  });

  it('reports data-only Guest Query media that cannot become a link', async () => {
    const prepared = await prepareTelegramRichMessage(
      'Photo',
      [{ data: 'aW1hZ2U=', name: 'chart.png', type: 'image' }],
      { linksOnly: true },
    );

    expect(prepared.richMessage.markdown).toBe('Photo\n\nchart.png could not be delivered.');
    expect(prepared.droppedAttachments).toEqual(['chart.png']);
    expect(prepared.richMessage.media).toBeUndefined();
  });

  it('renders Guest Query photo, video and audio URLs as download links', async () => {
    const prepared = await prepareTelegramRichMessage(
      'Media',
      [
        { fetchUrl: 'https://cdn.example/image.png', name: 'Chart', type: 'image' },
        {
          fetchUrl: 'https://cdn.example/clip.mp4',
          mimeType: 'video/mp4',
          name: 'clip.mp4',
          type: 'video',
        },
        {
          fetchUrl: 'https://cloud.example/f/audio-id',
          mimeType: 'audio/mpeg',
          name: 'track.mp3',
          type: 'audio',
        },
      ],
      { linksOnly: true },
    );

    expect(prepared.richMessage.markdown).toBe(
      [
        'Media',
        '📎 [Chart](https://cdn.example/image.png)',
        '📎 [clip.mp4](https://cdn.example/clip.mp4)',
        '📎 [track.mp3](https://cloud.example/f/audio-id)',
      ].join('\n\n'),
    );
    expect(prepared.richMessage.markdown).not.toContain('tg://');
    expect(prepared.richMessage.media).toBeUndefined();
    expect(prepared.uploads).toEqual([]);
    expect(loadAttachmentBufferMock).not.toHaveBeenCalled();
  });

  it('binds previously uploaded Telegram file_ids as Guest Rich media', async () => {
    const prepared = await prepareTelegramRichMessage(
      'Final',
      [
        { fetchUrl: 'https://cdn.example/image.png', name: 'Chart', type: 'image' },
        {
          fetchUrl: 'https://cdn.example/clip.mp4',
          mimeType: 'video/mp4',
          name: 'clip.mp4',
          type: 'video',
        },
        {
          fetchUrl: 'https://cdn.example/missing.mp3',
          mimeType: 'audio/mpeg',
          name: 'missing.mp3',
          type: 'audio',
        },
      ],
      { boundFileIds: ['AgAC-photo', 'BAAC-video'] },
    );

    expect(prepared.richMessage.markdown).toContain('![](tg://photo?id=media_0 "Chart")');
    expect(prepared.richMessage.markdown).toContain('![](tg://video?id=media_1 "clip.mp4")');
    expect(prepared.richMessage.markdown).toContain(
      '[missing.mp3](https://cdn.example/missing.mp3)',
    );
    expect(prepared.richMessage.media).toEqual([
      {
        id: 'media_0',
        media: { media: 'AgAC-photo', type: 'photo' },
      },
      {
        id: 'media_1',
        media: { media: 'BAAC-video', supports_streaming: true, type: 'video' },
      },
    ]);
    expect(prepared.uploads).toEqual([]);
    expect(loadAttachmentBufferMock).not.toHaveBeenCalled();
  });
});
