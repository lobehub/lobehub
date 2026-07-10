// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendFeishuAttachments } from './sendAttachments';

const makeApi = () => ({
  sendMessageWithMsgType: vi.fn().mockResolvedValue({ messageId: 'm-1', raw: {} }),
  uploadFile: vi.fn().mockResolvedValue({ file_key: 'file_xyz' }),
  uploadImage: vi.fn().mockResolvedValue({ image_key: 'img_abc' }),
});

describe('sendFeishuAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('uploads image and sends with msg_type=image', async () => {
    const api = makeApi();

    const n = await sendFeishuAttachments(api as any, 'oc_chat', [
      {
        data: Buffer.from('img-bytes').toString('base64'),
        mimeType: 'image/png',
        name: 'foo.png',
        type: 'image',
      },
    ]);

    expect(n).toBe(1);
    expect(api.uploadImage).toHaveBeenCalledWith(expect.any(Buffer), 'foo.png');
    expect(api.sendMessageWithMsgType).toHaveBeenCalledWith(
      'oc_chat',
      'image',
      JSON.stringify({ image_key: 'img_abc' }),
    );
  });

  it('infers file_type from extension/mime', async () => {
    const api = makeApi();

    await sendFeishuAttachments(api as any, 'oc_chat', [
      {
        data: Buffer.from('pdf').toString('base64'),
        mimeType: 'application/pdf',
        name: 'doc.pdf',
        type: 'file',
      },
    ]);

    expect(api.uploadFile).toHaveBeenCalledWith(expect.any(Buffer), 'doc.pdf', 'pdf');
    expect(api.sendMessageWithMsgType).toHaveBeenCalledWith(
      'oc_chat',
      'file',
      JSON.stringify({ file_key: 'file_xyz' }),
    );
  });

  it('routes video to msg_type=media and audio to msg_type=audio', async () => {
    const api = makeApi();

    await sendFeishuAttachments(api as any, 'oc_chat', [
      { data: Buffer.from('v').toString('base64'), name: 'v.mp4', type: 'video' },
      { data: Buffer.from('a').toString('base64'), name: 'a.mp3', type: 'audio' },
    ]);

    expect(api.uploadFile).toHaveBeenNthCalledWith(1, expect.any(Buffer), 'v.mp4', 'mp4');
    expect(api.sendMessageWithMsgType).toHaveBeenNthCalledWith(
      1,
      'oc_chat',
      'media',
      JSON.stringify({ file_key: 'file_xyz' }),
    );
    expect(api.uploadFile).toHaveBeenNthCalledWith(2, expect.any(Buffer), 'a.mp3', 'opus');
    expect(api.sendMessageWithMsgType).toHaveBeenNthCalledWith(
      2,
      'oc_chat',
      'audio',
      JSON.stringify({ file_key: 'file_xyz' }),
    );
  });

  it('continues remaining attachments when one upload fails', async () => {
    const api = makeApi();
    api.uploadImage
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce({ image_key: 'img_2' });

    const n = await sendFeishuAttachments(api as any, 'oc_chat', [
      { data: Buffer.from('a').toString('base64'), name: 'a.png', type: 'image' },
      { data: Buffer.from('b').toString('base64'), name: 'b.png', type: 'image' },
    ]);

    expect(n).toBe(1);
    expect(api.sendMessageWithMsgType).toHaveBeenCalledTimes(1);
  });

  it('returns 0 when no attachments resolve', async () => {
    const api = makeApi();

    const n = await sendFeishuAttachments(api as any, 'oc_chat', [
      { type: 'image' } as any, // no data, no fetchUrl
    ]);

    expect(n).toBe(0);
    expect(api.uploadImage).not.toHaveBeenCalled();
    expect(api.sendMessageWithMsgType).not.toHaveBeenCalled();
  });
});
