// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendSlackAttachments } from './sendAttachments';

const makeApi = () => ({
  completeFileUpload: vi.fn().mockResolvedValue(undefined),
  getFileUploadUrl: vi.fn().mockResolvedValue({
    file_id: 'F123',
    upload_url: 'https://files.slack.com/upload/x',
  }),
  putFileBytes: vi.fn().mockResolvedValue(undefined),
});

describe('sendSlackAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('runs the 3-step v2 flow for base64 attachments', async () => {
    const api = makeApi();

    const n = await sendSlackAttachments(api as any, {
      attachments: [
        {
          data: Buffer.from('hello').toString('base64'),
          mimeType: 'image/png',
          name: 'foo.png',
          type: 'image',
        },
      ],
      channelId: 'C1',
      initialComment: 'caption',
      threadTs: '123.456',
    });

    expect(n).toBe(1);
    expect(api.getFileUploadUrl).toHaveBeenCalledWith({
      filename: 'foo.png',
      length: Buffer.from('hello').length,
    });
    expect(api.putFileBytes).toHaveBeenCalledWith(
      'https://files.slack.com/upload/x',
      expect.any(Buffer),
    );
    expect(api.completeFileUpload).toHaveBeenCalledWith({
      channelId: 'C1',
      files: [{ id: 'F123', title: 'foo.png' }],
      initialComment: 'caption',
      threadTs: '123.456',
    });
  });

  it('fetches fetchUrl attachments and uploads the bytes', async () => {
    const api = makeApi();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }) as any,
    );

    const n = await sendSlackAttachments(api as any, {
      attachments: [{ fetchUrl: 'https://cdn.example.com/pic.png', type: 'image' }],
      channelId: 'C1',
    });

    expect(n).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/pic.png', expect.any(Object));
    expect(api.getFileUploadUrl).toHaveBeenCalled();
    expect(api.putFileBytes).toHaveBeenCalled();
    expect(api.completeFileUpload).toHaveBeenCalled();
  });

  it('keeps remaining attachments when one fails to upload', async () => {
    const api = makeApi();
    api.getFileUploadUrl.mockRejectedValueOnce(new Error('slack 429')).mockResolvedValueOnce({
      file_id: 'F999',
      upload_url: 'https://files.slack.com/upload/y',
    });

    const n = await sendSlackAttachments(api as any, {
      attachments: [
        { data: Buffer.from('a').toString('base64'), name: 'a.png', type: 'image' },
        { data: Buffer.from('b').toString('base64'), name: 'b.png', type: 'image' },
      ],
      channelId: 'C1',
    });

    expect(n).toBe(1);
    expect(api.completeFileUpload).toHaveBeenCalledWith(
      expect.objectContaining({ files: [{ id: 'F999', title: 'b.png' }] }),
    );
  });

  it('returns 0 when all attachments fail (no completeFileUpload call)', async () => {
    const api = makeApi();
    api.getFileUploadUrl.mockRejectedValue(new Error('slack 500'));

    const n = await sendSlackAttachments(api as any, {
      attachments: [{ data: Buffer.from('x').toString('base64'), name: 'x.png', type: 'image' }],
      channelId: 'C1',
    });

    expect(n).toBe(0);
    expect(api.completeFileUpload).not.toHaveBeenCalled();
  });

  it('returns 0 when completeFileUpload itself fails', async () => {
    const api = makeApi();
    api.completeFileUpload.mockRejectedValueOnce(new Error('slack down'));

    const n = await sendSlackAttachments(api as any, {
      attachments: [{ data: Buffer.from('x').toString('base64'), name: 'x.png', type: 'image' }],
      channelId: 'C1',
    });

    expect(n).toBe(0);
  });
});
