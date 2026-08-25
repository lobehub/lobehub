import { describe, expect, it, vi } from 'vitest';

import { deliverEditedReply } from './replyDelivery';

describe('deliverEditedReply', () => {
  const attachments = [{ data: 'aGk=', type: 'image' }] as const;

  it('edits text and posts attachments separately', async () => {
    const editText = vi.fn().mockResolvedValue(undefined);
    const postAttachments = vi.fn().mockResolvedValue(undefined);
    const postText = vi.fn().mockResolvedValue(undefined);

    await expect(
      deliverEditedReply({
        attachments: [...attachments],
        editText,
        postAttachments,
        postText,
        text: 'done',
      }),
    ).resolves.toEqual({ text: 'done', usedFallback: false });
    expect(editText).toHaveBeenCalledWith('done');
    expect(postAttachments).toHaveBeenCalledWith(attachments);
    expect(postText).not.toHaveBeenCalled();
  });

  it('posts text without duplicating attachments when editing fails', async () => {
    const postAttachments = vi.fn().mockResolvedValue(undefined);
    const postText = vi.fn().mockResolvedValue(undefined);

    await expect(
      deliverEditedReply({
        attachments: [...attachments],
        editText: vi.fn().mockRejectedValue(new Error('edit failed')),
        postAttachments,
        postText,
        text: 'done',
      }),
    ).resolves.toEqual({ text: 'done', usedFallback: true });
    expect(postText).toHaveBeenCalledWith('done');
    expect(postAttachments).toHaveBeenCalledOnce();
  });

  it('posts fallback text before a slow attachment finishes', async () => {
    let finishAttachment!: () => void;
    const postAttachments = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishAttachment = resolve;
        }),
    );
    const postText = vi.fn().mockResolvedValue(undefined);

    const delivery = deliverEditedReply({
      attachments: [...attachments],
      editText: vi.fn().mockRejectedValue(new Error('edit failed')),
      postAttachments,
      postText,
      text: 'done',
    });
    await vi.waitFor(() => expect(postText).toHaveBeenCalledOnce());
    finishAttachment();

    await expect(delivery).resolves.toEqual({ text: 'done', usedFallback: true });
  });

  it('normalizes attachment-only completion text', async () => {
    const editText = vi.fn().mockResolvedValue(undefined);

    await expect(
      deliverEditedReply({
        attachments: [...attachments],
        editText,
        postAttachments: vi.fn().mockResolvedValue(undefined),
        postText: vi.fn().mockResolvedValue(undefined),
        text: '',
      }),
    ).resolves.toEqual({ text: '📎', usedFallback: false });
    expect(editText).toHaveBeenCalledWith('📎');
  });
});
