// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sharpMocks = vi.hoisted(() => ({
  metadata: vi.fn(),
  toBuffer: vi.fn(),
}));

vi.mock('sharp', () => {
  const chain = {
    flatten: vi.fn(() => chain),
    jpeg: vi.fn(() => chain),
    metadata: sharpMocks.metadata,
    resize: vi.fn(() => chain),
    rotate: vi.fn(() => chain),
    toBuffer: sharpMocks.toBuffer,
  };
  return { default: vi.fn(() => chain) };
});

const {
  compressImageToBudget,
  PLATFORM_ATTACHMENT_BUDGETS,
  prepareAttachmentsForBudget,
  splitFallbackMessages,
} = await import('./attachmentBudget');

const MB = 1024 * 1024;

describe('compressImageToBudget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharpMocks.metadata.mockResolvedValue({ pages: 1 });
  });

  it('returns the first ladder rung that fits the budget', async () => {
    sharpMocks.toBuffer
      .mockResolvedValueOnce(Buffer.alloc(3 * MB))
      .mockResolvedValueOnce(Buffer.alloc(1 * MB));

    const result = await compressImageToBudget(Buffer.alloc(5 * MB), 2 * MB);

    expect(result?.length).toBe(1 * MB);
    expect(sharpMocks.toBuffer).toHaveBeenCalledTimes(2);
  });

  it('returns undefined when no rung fits', async () => {
    sharpMocks.toBuffer.mockResolvedValue(Buffer.alloc(3 * MB));

    const result = await compressImageToBudget(Buffer.alloc(5 * MB), 2 * MB);

    expect(result).toBeUndefined();
  });

  it('refuses an animated image instead of flattening it to one frame', async () => {
    sharpMocks.metadata.mockResolvedValue({ pages: 24 });

    expect(await compressImageToBudget(Buffer.alloc(64), 1024)).toBeUndefined();
    expect(sharpMocks.toBuffer).not.toHaveBeenCalled();
  });

  it('returns undefined when sharp cannot decode the source', async () => {
    sharpMocks.toBuffer.mockRejectedValue(new Error('unsupported image format'));

    const result = await compressImageToBudget(Buffer.from('not an image'), 2 * MB);

    expect(result).toBeUndefined();
  });
});

describe('prepareAttachmentsForBudget', () => {
  const budget = PLATFORM_ATTACHMENT_BUDGETS.wechat;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    sharpMocks.metadata.mockResolvedValue({ pages: 1 });
  });

  it('passes attachments within budget through untouched', async () => {
    const attachment = {
      fetchUrl: 'https://example.com/f/small.png',
      name: 'small.png',
      size: 100 * 1024,
      type: 'image' as const,
    };

    const result = await prepareAttachmentsForBudget([attachment], budget);

    expect(result.attachments).toEqual([attachment]);
    expect(result.fallbackLines).toEqual([]);
  });

  it('passes attachments with unknown size through untouched', async () => {
    const attachment = {
      fetchUrl: 'https://example.com/f/unknown.mp4',
      name: 'unknown.mp4',
      type: 'video' as const,
    };

    const result = await prepareAttachmentsForBudget([attachment], budget);

    expect(result.attachments).toEqual([attachment]);
    expect(result.fallbackLines).toEqual([]);
  });

  it('recompresses an over-budget image into inline data', async () => {
    const source = Buffer.alloc(3 * MB, 1);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(source, { status: 200 })));
    sharpMocks.toBuffer.mockResolvedValueOnce(Buffer.alloc(1 * MB, 2));

    const result = await prepareAttachmentsForBudget(
      [
        {
          fetchUrl: 'https://example.com/f/big.png',
          name: 'big.png',
          size: 3 * MB,
          type: 'image' as const,
        },
      ],
      budget,
    );

    expect(result.fallbackLines).toEqual([]);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      fetchUrl: undefined,
      mimeType: 'image/jpeg',
      // Discord and Slack upload `name` verbatim, so JPEG bytes must not keep
      // a `.png` extension.
      name: 'big.jpg',
      size: 1 * MB,
      type: 'image',
    });
    expect(result.attachments[0].data).toBe(Buffer.alloc(1 * MB, 2).toString('base64'));
  });

  it('degrades an over-budget image to a link when compression cannot fit it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(Buffer.alloc(3 * MB), { status: 200 })),
    );
    sharpMocks.toBuffer.mockResolvedValue(Buffer.alloc(3 * MB));

    const result = await prepareAttachmentsForBudget(
      [
        {
          fetchUrl: 'https://example.com/f/huge.png',
          name: 'huge.png',
          size: 3 * MB,
          type: 'image' as const,
        },
      ],
      budget,
    );

    expect(result.attachments).toEqual([]);
    expect(result.fallbackLines).toHaveLength(1);
    expect(result.fallbackLines[0]).toContain('huge.png');
    expect(result.fallbackLines[0]).toContain('https://example.com/f/huge.png');
  });

  it('caps the displayed filename so one fallback line stays short', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await prepareAttachmentsForBudget(
      [
        {
          fetchUrl: 'https://example.com/f/long',
          name: `${'n'.repeat(300)}.zip`,
          size: 40 * MB,
          type: 'file' as const,
        },
      ],
      budget,
    );

    expect(result.attachments).toEqual([]);
    expect(result.fallbackLines).toHaveLength(1);
    expect(result.fallbackLines[0]).toBe(
      `📎 ${'n'.repeat(59)}\u2026 (40.0MB)\nhttps://example.com/f/long`,
    );
  });

  it('degrades an over-budget file to a download link without fetching it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await prepareAttachmentsForBudget(
      [
        {
          fetchUrl: 'https://example.com/f/movie.mp4',
          name: 'movie.mp4',
          size: 100 * MB,
          type: 'video' as const,
        },
      ],
      budget,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.attachments).toEqual([]);
    expect(result.fallbackLines[0]).toContain('movie.mp4');
    expect(result.fallbackLines[0]).toContain('100.0MB');
    expect(result.fallbackLines[0]).toContain('https://example.com/f/movie.mp4');
  });

  it('keeps an over-budget attachment without a fetchUrl as a last resort', async () => {
    const attachment = {
      data: Buffer.alloc(30 * MB).toString('base64'),
      name: 'inline.bin',
      type: 'file' as const,
    };

    const result = await prepareAttachmentsForBudget([attachment], budget);

    expect(result.attachments).toEqual([attachment]);
    expect(result.fallbackLines).toEqual([]);
  });
});

describe('splitFallbackMessages', () => {
  it('packs lines into one message while they fit', () => {
    expect(splitFallbackMessages(['📎 a\nurl', '📎 b\nurl'], 2000)).toEqual([
      '📎 a\nurl\n\n📎 b\nurl',
    ]);
    expect(splitFallbackMessages([], 2000)).toEqual([]);
  });

  it('starts a new message rather than exceeding the platform cap', () => {
    const lines = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)];

    // Two 40-char lines plus the blank-line separator are 82 chars, so a
    // 100-char cap fits two lines per message and never splits one.
    expect(splitFallbackMessages(lines, 100)).toEqual([`${lines[0]}\n\n${lines[1]}`, lines[2]]);
  });

  it('never truncates a single line, even when it alone exceeds the cap', () => {
    const line = 'x'.repeat(50);

    expect(splitFallbackMessages([line], 10)).toEqual([line]);
  });
});
