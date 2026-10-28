import { describe, expect, it, vi } from 'vitest';

import type { MessageItem } from '../types';
import { MessageExecutionRuntime } from './index';
import { collectImageCandidates, imageMediaType, MAX_MESSAGE_IMAGES } from './messageImages';

const message = (id: string, timestamp: string, extra: Partial<MessageItem> = {}): MessageItem => ({
  author: { id: 'u1', name: 'none01161' },
  content: '',
  id,
  timestamp,
  ...extra,
});

const screenshot = {
  contentType: 'image/png',
  name: 'image.png',
  size: 1000,
  url: 'https://cdn.discordapp.com/attachments/1/2/image.png?ex=1',
};

// Regression: a screenshot posted on its own read as `none01161: ` with nothing after it, so
// the woken bot answered that it could not see any screenshot.
const page = [
  message('1564834667952087122', '2026-10-28T02:54:18.062Z', { content: '这个能修一下吗，桌面端' }),
  message('1564834596426747917', '2026-10-28T02:54:01.009Z', {
    content: '这个挂着的页面好像过一会就变lobeai了',
  }),
  message('1564834535558881420', '2026-10-28T02:53:46.497Z', { attachments: [screenshot] }),
];

const runtimeWith = (resolveImages?: ReturnType<typeof vi.fn>) =>
  new MessageExecutionRuntime({
    resolveImages: resolveImages as any,
    service: { readMessages: vi.fn().mockResolvedValue({ messages: page }) } as any,
  });

const read = (runtime: MessageExecutionRuntime) =>
  runtime.readMessages({ channelId: '1149011097802788864', platform: 'discord' });

describe('readMessages image attachments', () => {
  it('attaches stored images to the result so a vision model can see them', async () => {
    const resolveImages = vi.fn(async (candidates: any[]) =>
      candidates.map((c) => ({ ...c, fileId: 'file_1', url: 'https://app/f/file_1' })),
    );

    const output = await read(runtimeWith(resolveImages));

    expect(resolveImages).toHaveBeenCalledWith([
      {
        mediaType: 'image/png',
        messageId: '1564834535558881420',
        name: 'image.png',
        size: 1000,
        url: screenshot.url,
      },
    ]);
    expect(output.state.images).toEqual([
      {
        fileId: 'file_1',
        mediaType: 'image/png',
        messageId: '1564834535558881420',
        name: 'image.png',
        size: 1000,
        url: 'https://app/f/file_1',
      },
    ]);
    expect(output.content).toContain('none01161: [image #1 attached to this result: image.png]');
    expect(output.content).toContain('attached to this result as image #1.');
  });

  it('still names the image when it cannot be stored, and tells the model it cannot see it', async () => {
    const output = await read(runtimeWith(vi.fn().mockRejectedValue(new Error('S3 down'))));

    expect(output.success).toBe(true);
    expect(output.state.images).toBeUndefined();
    expect(output.content).toContain('none01161: [attachment: image.png, image/png]');
    expect(output.content).toContain('could not be loaded, so you cannot see them');
  });

  it('names the image in text when no store is wired', async () => {
    const output = await read(runtimeWith());

    expect(output.state.images).toBeUndefined();
    expect(output.content).toContain('[attachment: image.png, image/png]');
  });

  it('applies to searchMessages too', async () => {
    const runtime = new MessageExecutionRuntime({
      resolveImages: vi.fn(async (candidates: any[]) =>
        candidates.map((c) => ({ ...c, url: 'https://app/f/file_2' })),
      ) as any,
      service: { searchMessages: vi.fn().mockResolvedValue({ messages: page }) } as any,
    });

    const output = await runtime.searchMessages({
      channelId: 'c1',
      platform: 'discord',
      query: 'lobeai',
    });

    expect(output.state.images).toHaveLength(1);
  });
});

describe('collectImageCandidates', () => {
  it('keeps the newest images up to the cap and reports the total', () => {
    const many = Array.from({ length: MAX_MESSAGE_IMAGES + 2 }, (_, i) =>
      message(`m${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), {
        attachments: [{ ...screenshot, name: `${i}.png` }],
      }),
    );

    const { candidates, total } = collectImageCandidates(many);

    expect(total).toBe(MAX_MESSAGE_IMAGES + 2);
    expect(candidates.map((c) => c.name)).toEqual(['5.png', '4.png', '3.png', '2.png']);
  });

  it('skips files a vision model cannot read', () => {
    expect(imageMediaType({ contentType: 'image/svg+xml', name: 'a.svg', url: 'x' })).toBe(
      undefined,
    );
    expect(imageMediaType({ contentType: 'application/pdf', name: 'a.pdf', url: 'x' })).toBe(
      undefined,
    );
    expect(imageMediaType({ name: 'shot.JPG', url: 'x' })).toBe('image/jpeg');
  });
});
