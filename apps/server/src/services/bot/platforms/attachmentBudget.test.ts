// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as PublicUrlFetchModule from './publicUrlFetch';

// These tests stub `fetch` directly; the SSRF guard in front of it resolves DNS
// for real, which has nothing to do with what they assert. Its own behaviour is
// covered in publicUrlFetch.test.ts.
vi.mock('./publicUrlFetch', async () => ({
  // Spread the real module: a full mock silently drops every export it
  // does not name, so adding one to publicUrlFetch breaks suites that
  // never cared about it.
  ...(await vi.importActual<typeof PublicUrlFetchModule>('./publicUrlFetch')),
  fetchPublicUrl: async (url: string, timeoutMs: number) => ({
    dispose: async () => undefined,
    response: await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }),
  }),
}));

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
  summarizeDegradations,
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

  it('probes an unmeasured attachment and keeps it when it fits', async () => {
    // `attachmentsInputSchema` carries no `size`, so raw botMessage attachments
    // arrive unmeasured — the budget has to establish the size itself.
    const attachment = {
      fetchUrl: 'https://example.com/f/small.mp4',
      name: 'small.mp4',
      type: 'video' as const,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        headers: new Headers({ 'content-length': String(1 * MB) }),
        ok: true,
        status: 200,
      }),
    );

    const result = await prepareAttachmentsForBudget([attachment], budget);

    expect(result.attachments).toEqual([attachment]);
    expect(result.fallbackLines).toEqual([]);
  });

  it('degrades an unmeasured attachment the probe reports as over budget', async () => {
    const attachment = {
      fetchUrl: 'https://example.com/f/huge.mp4',
      name: 'huge.mp4',
      type: 'video' as const,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        headers: new Headers({ 'content-length': String(500 * MB) }),
        ok: true,
        status: 200,
      }),
    );

    const result = await prepareAttachmentsForBudget([attachment], budget);

    expect(result.attachments).toEqual([]);
    expect(result.fallbackLines[0]).toContain('https://example.com/f/huge.mp4');
  });

  it('degrades rather than silently dropping when the size cannot be established', async () => {
    // Regression: an unmeasurable attachment used to skip every budget rule and
    // then be refused by the loader's in-memory cap during materialization —
    // the sender skipped it, still posted the text, and reported success, so it
    // vanished with neither file nor link.
    const attachment = {
      fetchUrl: 'https://example.com/f/chunked.mp4',
      name: 'chunked.mp4',
      type: 'video' as const,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ headers: new Headers(), ok: true, status: 200 }),
    );

    const result = await prepareAttachmentsForBudget([attachment], budget);

    expect(result.attachments).toEqual([]);
    expect(result.fallbackLines[0]).toContain('https://example.com/f/chunked.mp4');
  });

  it('probes unmeasured attachments concurrently, not one after another', async () => {
    // Regression: serial probing meant N slow URLs cost N x the timeout before
    // the first platform send even began.
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return { headers: new Headers({ 'content-length': String(1024) }), ok: true, status: 200 };
      }),
    );

    const attachments = Array.from({ length: 5 }, (_, i) => ({
      fetchUrl: `https://example.com/f/file-${i}.mp4`,
      name: `file-${i}.mp4`,
      type: 'video' as const,
    }));

    await prepareAttachmentsForBudget(attachments, budget);

    expect(peak).toBeGreaterThan(1);
  });

  it('keeps an unmeasurable attachment that has no link to fall back to', async () => {
    const attachment = { data: 'AAAA', name: 'inline.bin', type: 'file' as const };

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

  it('sends the original as a link when the sender picked the link strategy', async () => {
    // The point of the choice is that the original survives: a `link` push must
    // not download or re-encode the image at all, or the recipient would get a
    // JPEG-shaped link to something that no longer matches the file.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

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
      { oversizeImageStrategy: 'link' },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sharpMocks.toBuffer).not.toHaveBeenCalled();
    expect(result.attachments).toEqual([]);
    expect(result.fallbackLines[0]).toContain('big.png');
    expect(result.fallbackLines[0]).toContain('https://example.com/f/big.png');
  });

  it('still compresses when no strategy is given', async () => {
    // The option is additive: every caller that predates it keeps compressing.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(Buffer.alloc(3 * MB, 1), { status: 200 })),
    );
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
    expect(result.attachments[0]).toMatchObject({ mimeType: 'image/jpeg' });
  });

  it('reports which step failed when an image degrades to a link', async () => {
    // Regression: every failure in this chain collapsed into the same silent
    // `undefined`, so a caller could degrade every image in a push with no way
    // to say which step gave up — the sender could only report "it sent a
    // link". The reason rides the result; nothing in this module prints.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

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

    expect(result.fallbackLines).toHaveLength(1);
    expect(result.degradations).toEqual([
      { name: 'big.png', reason: 'source-unavailable', size: 3 * MB, type: 'image' },
    ]);
  });

  it("labels the sender's own link choice as a choice, not a failure", async () => {
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
      { oversizeImageStrategy: 'link' },
    );

    expect(result.degradations).toEqual([
      { name: 'big.png', reason: 'strategy-link', size: 3 * MB, type: 'image' },
    ]);
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

  it('degrades a Slack file above the in-memory ceiling instead of dropping it', async () => {
    // Regression: Slack's budget used to be the API's 1GB cap, so a 60MB file
    // passed the budget pass as an upload and was then refused during
    // materialization — the attachment vanished with neither file nor link.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await prepareAttachmentsForBudget(
      [
        {
          fetchUrl: 'https://example.com/f/big.zip',
          name: 'big.zip',
          size: 60 * MB,
          type: 'file' as const,
        },
      ],
      PLATFORM_ATTACHMENT_BUDGETS.slack,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.attachments).toEqual([]);
    expect(result.fallbackLines[0]).toContain('https://example.com/f/big.zip');
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

describe('summarizeDegradations', () => {
  it('flattens a filename that would forge extra log lines', () => {
    // A filename is attacker-controlled and lands in persistent logs; a newline
    // in it fabricates a whole additional entry that a reader cannot tell from
    // a real one.
    const summary = summarizeDegradations([
      {
        name: 'invoice.png\n[messenger:wechat] 0 attachment(s) could not be sent as files',
        reason: 'source-unavailable',
        type: 'image',
      },
    ]);

    expect(summary.split('\n')).toHaveLength(1);
    expect(summary).toContain('invoice.png');
  });

  it('strips control characters', () => {
    const summary = summarizeDegradations([
      { name: 'a b c\td', reason: 'upload-failed', type: 'file' },
    ]);

    expect(summary).toBe('a b c d: upload-failed');
  });

  it('caps an absurd filename so it cannot crowd out the rest of the line', () => {
    const summary = summarizeDegradations([
      { name: 'n'.repeat(500), reason: 'compression-failed', type: 'image' },
    ]);

    expect(summary.length).toBeLessThan(120);
    expect(summary).toContain('compression-failed');
  });

  it('sanitizes caller-supplied reason detail too', () => {
    // `failures.detail` carries platform error text, no more trusted than the
    // filename it sits next to.
    const summary = summarizeDegradations([
      { name: 'a.png', reason: 'upload-failed (bad\nmedia)', type: 'image' },
    ]);

    expect(summary.split('\n')).toHaveLength(1);
  });

  it('names the type when the attachment has no filename', () => {
    expect(summarizeDegradations([{ reason: 'not-compressible', type: 'video' }])).toBe(
      '(unnamed video): not-compressible',
    );
  });
});
