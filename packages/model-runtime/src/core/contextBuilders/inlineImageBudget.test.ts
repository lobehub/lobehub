import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenAIChatMessage, UserMessageContentPart } from '../../types';
import { imageUrlToBase64 } from '../../utils/imageToBase64';
import { buildAnthropicMessages } from './anthropic';
import {
  clearInlineImageCache,
  type ImageSlot,
  inlineImagesWithinBudget,
  OMITTED_IMAGE_PLACEHOLDER,
  OVERSIZED_IMAGE_PLACEHOLDER,
  planImageOmissions,
  setInlineImageNormalizer,
} from './inlineImageBudget';

vi.mock('../../utils/imageToBase64', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  imageUrlToBase64: vi.fn(),
}));

const MB = 1024 * 1024;
const BUDGET = { lowWatermark: 0.6, maxTotalBase64Bytes: 20 * MB };

/** One image per message, all in user messages, `mb` megabytes each. */
const userSlots = (sizesMb: number[]): ImageSlot[] =>
  sizesMb.map((mb, index) => ({ bytes: mb * MB, messageIndex: index, userAnchorIndex: index }));

const dataUri = (char: string, length: number) => `data:image/png;base64,${char.repeat(length)}`;

const imagePart = (url: string): UserMessageContentPart => ({
  image_url: { url },
  type: 'image_url',
});

describe('planImageOmissions', () => {
  it('keeps everything under the budget', () => {
    expect(planImageOmissions(userSlots([5, 5, 5]), BUDGET).size).toBe(0);
  });

  it('omits the oldest images down to the low watermark once over budget', () => {
    // 5 × 5MB: crossing 20MB at the fifth image omits the oldest until ≤ 12MB.
    const omitted = planImageOmissions(userSlots([5, 5, 5, 5, 5]), BUDGET);
    expect([...omitted]).toEqual([0, 1, 2]);
  });

  it('never omits images in the newest message or its latest user message', () => {
    const slots: ImageSlot[] = [
      { bytes: 1 * MB, messageIndex: 0, userAnchorIndex: 0 },
      // The user's attachments, followed by tool results in the same turn.
      { bytes: 8 * MB, messageIndex: 2, userAnchorIndex: 2 },
      { bytes: 8 * MB, messageIndex: 4, userAnchorIndex: 2 },
      { bytes: 8 * MB, messageIndex: 6, userAnchorIndex: 2 },
    ];
    const omitted = planImageOmissions(slots, BUDGET);
    expect(omitted.has(1)).toBe(false);
    expect(omitted.has(3)).toBe(false);
    expect([...omitted].sort()).toEqual([0, 2]);
  });

  it('trims an over-budget message once a text-only follow-up arrives', () => {
    // Six 4MB attachments in one message stay protected while it is the newest turn.
    const slots: ImageSlot[] = Array.from({ length: 6 }, () => ({
      bytes: 4 * MB,
      messageIndex: 0,
      userAnchorIndex: 0,
    }));
    expect(planImageOmissions(slots, BUDGET, [0]).size).toBe(0);
    // The next user message carries no images but still trims down to the watermark.
    expect([...planImageOmissions(slots, BUDGET, [0, 2])]).toEqual([0, 1, 2]);
  });

  it('is prefix-stable and rewrites the history only a few times as images accumulate', () => {
    const all = userSlots(Array.from({ length: 60 }, () => 1));
    let previous = new Set<number>();
    let rewrites = 0;

    for (let turn = 1; turn <= all.length; turn++) {
      const omitted = planImageOmissions(all.slice(0, turn), BUDGET);
      // Appending a message never restores an omitted image.
      for (const index of previous) expect(omitted.has(index)).toBe(true);
      if (omitted.size !== previous.size) rewrites++;
      previous = omitted;
    }

    // 1MB per turn against a 20MB budget cut to 12MB: one rewrite per 8MB of new
    // images (turns 21, 29, 37, 45, 53), not one per turn after crossing the budget.
    expect(rewrites).toBe(5);
  });
});

describe('inlineImagesWithinBudget', () => {
  beforeEach(() => {
    clearInlineImageCache();
    vi.mocked(imageUrlToBase64).mockReset();
  });

  afterEach(() => {
    setInlineImageNormalizer(undefined);
  });

  it('returns the input untouched when there are no images', async () => {
    const messages: OpenAIChatMessage[] = [{ content: 'hi', role: 'user' }];
    expect(await inlineImagesWithinBudget(messages)).toBe(messages);
  });

  it('replaces the oldest images with a fixed placeholder without mutating the input', async () => {
    const messages: OpenAIChatMessage[] = ['a', 'b', 'c'].map((char) => ({
      content: [{ text: 'look', type: 'text' }, imagePart(dataUri(char, 1000))],
      role: 'user',
    }));
    const snapshot = structuredClone(messages);

    const result = await inlineImagesWithinBudget(messages, { maxTotalBase64Bytes: 2500 });

    expect(messages).toEqual(snapshot);
    expect(result[0].content).toEqual([
      { text: 'look', type: 'text' },
      { text: OMITTED_IMAGE_PLACEHOLDER, type: 'text' },
    ]);
    expect(result[1].content).toEqual([
      { text: 'look', type: 'text' },
      { text: OMITTED_IMAGE_PLACEHOLDER, type: 'text' },
    ]);
    expect(result[2].content).toEqual(messages[2].content);
  });

  it('produces identical output for identical input', async () => {
    const messages: OpenAIChatMessage[] = ['a', 'b', 'c', 'd'].map((char) => ({
      content: [imagePart(dataUri(char, 1000))],
      role: 'user',
    }));
    const first = await inlineImagesWithinBudget(messages, { maxTotalBase64Bytes: 2500 });
    const second = await inlineImagesWithinBudget(messages, { maxTotalBase64Bytes: 2500 });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('budgets tool-result images from remote URLs and reuses the download', async () => {
    vi.mocked(imageUrlToBase64).mockImplementation(async (url) => ({
      base64: url.slice(-1).repeat(1000),
      mimeType: 'image/png',
    }));
    const messages: OpenAIChatMessage[] = [
      { content: 'read the files', role: 'user' },
      {
        content: '',
        role: 'assistant',
        tool_calls: ['a', 'b', 'c'].map((char) => ({
          function: { arguments: '{}', name: 'readFile' },
          id: `call_${char}`,
          type: 'function' as const,
        })),
      },
      ...['a', 'b', 'c'].map((char): OpenAIChatMessage => ({
        content: [imagePart(`https://example.com/${char}`)],
        role: 'tool',
        tool_call_id: `call_${char}`,
      })),
    ];

    const result = await inlineImagesWithinBudget(messages, { maxTotalBase64Bytes: 2500 });
    await inlineImagesWithinBudget(messages, { maxTotalBase64Bytes: 2500 });

    expect(imageUrlToBase64).toHaveBeenCalledTimes(3);
    expect(result[2].content).toEqual([{ text: OMITTED_IMAGE_PLACEHOLDER, type: 'text' }]);
    expect(result[3].content).toEqual([{ text: OMITTED_IMAGE_PLACEHOLDER, type: 'text' }]);
    expect(result[4].content).toEqual([imagePart(`data:image/png;base64,${'c'.repeat(1000)}`)]);
  });

  it('leaves orphan tool results untouched for the plain-text fallback', async () => {
    const messages: OpenAIChatMessage[] = [
      { content: 'hi', role: 'user' },
      { content: [imagePart('https://example.com/orphan')], role: 'tool', tool_call_id: 'gone' },
    ];

    expect(await inlineImagesWithinBudget(messages)).toBe(messages);
    expect(imageUrlToBase64).not.toHaveBeenCalled();
  });

  it('applies the registered normalizer and omits images it cannot shrink enough', async () => {
    const normalizer = vi.fn(async (image: { base64: string; mimeType: string }) =>
      image.base64.startsWith('big') ? image : { base64: 'small', mimeType: 'image/webp' },
    );
    setInlineImageNormalizer(normalizer);
    const messages: OpenAIChatMessage[] = [
      { content: [imagePart(dataUri('x', 50))], role: 'user' },
      { content: [imagePart(`data:image/png;base64,big${'y'.repeat(100)}`)], role: 'user' },
    ];

    const result = await inlineImagesWithinBudget(messages, { maxImageBase64Bytes: 60 });

    expect(normalizer).toHaveBeenCalledWith(
      { base64: 'x'.repeat(50), mimeType: 'image/png' },
      { maxBase64Bytes: 60, maxLongEdge: 2000 },
    );
    expect(result[0].content).toEqual([imagePart('data:image/webp;base64,small')]);
    expect(result[1].content).toEqual([{ text: OVERSIZED_IMAGE_PLACEHOLDER, type: 'text' }]);
  });
});

describe('buildAnthropicMessages image budget', () => {
  beforeEach(() => {
    clearInlineImageCache();
  });

  it('keeps an image-heavy conversation under the request budget', async () => {
    // Seven 4MB screenshots: 28MB of base64 would exceed the 20MB default budget.
    const messages: OpenAIChatMessage[] = Array.from({ length: 7 }, (_, index) => ({
      content: [
        { text: `screenshot ${index}`, type: 'text' },
        imagePart(dataUri(String.fromCharCode(97 + index), 4 * MB)),
      ],
      role: 'user',
    }));

    const result = await buildAnthropicMessages(messages);
    const imageBytes = result
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .reduce(
        (total, block) =>
          total +
          (block.type === 'image' && block.source.type === 'base64' ? block.source.data.length : 0),
        0,
      );

    expect(imageBytes).toBeLessThanOrEqual(20 * MB);
    expect(result[0].content).toEqual([
      { text: 'screenshot 0', type: 'text' },
      { text: OMITTED_IMAGE_PLACEHOLDER, type: 'text' },
    ]);
  });
});
