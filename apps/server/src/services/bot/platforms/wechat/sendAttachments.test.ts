// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// These tests stub `fetch` directly; the SSRF guard in front of it resolves DNS
// for real, which has nothing to do with what they assert. Its own behaviour is
// covered in publicUrlFetch.test.ts.
vi.mock('../publicUrlFetch', () => ({
  fetchPublicUrl: async (url: string, timeoutMs: number) => ({
    dispose: async () => undefined,
    response: await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }),
  }),
}));

const budgetMocks = vi.hoisted(() => ({
  compressImageToBudget: vi.fn(),
}));

vi.mock('../attachmentBudget', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  compressImageToBudget: budgetMocks.compressImageToBudget,
}));

const { PLATFORM_ATTACHMENT_BUDGETS } = await import('../attachmentBudget');
const { sendWechatAttachments } = await import('./sendAttachments');

const MB = 1024 * 1024;

const makeApi = () => ({
  sendItem: vi.fn().mockResolvedValue({}),
  sendMessage: vi.fn().mockResolvedValue({}),
  uploadCdnMedia: vi.fn().mockResolvedValue({
    aesKey: 'key',
    cipherSize: 16,
    encryptQueryParam: 'param',
    rawSize: 10,
  }),
});

describe('sendWechatAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('uploads an in-budget attachment as-is', async () => {
    const api = makeApi();
    const bytes = Buffer.alloc(1024, 1);

    await sendWechatAttachments(
      api as any,
      'user-1',
      [{ data: bytes.toString('base64'), name: 'a.png', type: 'image' }],
      'token-1',
    );

    expect(budgetMocks.compressImageToBudget).not.toHaveBeenCalled();
    expect(api.uploadCdnMedia).toHaveBeenCalledTimes(1);
    expect(api.sendItem).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('recompresses an over-budget image before uploading', async () => {
    const api = makeApi();
    const oversized = Buffer.alloc(3 * MB, 1);
    const compressed = Buffer.alloc(1 * MB, 2);
    budgetMocks.compressImageToBudget.mockResolvedValueOnce(compressed);

    await sendWechatAttachments(
      api as any,
      'user-1',
      [{ data: oversized.toString('base64'), name: 'big.png', type: 'image' }],
      'token-1',
    );

    expect(budgetMocks.compressImageToBudget).toHaveBeenCalledWith(
      expect.any(Buffer),
      PLATFORM_ATTACHMENT_BUDGETS.wechat.imageMaxBytes,
    );
    const [uploadTarget, , uploadedBytes] = api.uploadCdnMedia.mock.calls[0];
    expect(uploadTarget).toBe('user-1');
    expect(uploadedBytes).toBe(compressed);
    expect(api.sendItem).toHaveBeenCalledTimes(1);
  });

  it('sends a download link when an image cannot be compressed under budget', async () => {
    const api = makeApi();
    const oversized = Buffer.alloc(3 * MB, 1);
    budgetMocks.compressImageToBudget.mockResolvedValueOnce(undefined);

    await sendWechatAttachments(
      api as any,
      'user-1',
      [
        {
          data: oversized.toString('base64'),
          fetchUrl: 'https://example.com/f/big.png',
          name: 'big.png',
          type: 'image',
        },
      ],
      'token-1',
    );

    expect(api.uploadCdnMedia).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('https://example.com/f/big.png'),
      'token-1',
    );
  });

  it('sends a download link for an over-budget file without trying compression', async () => {
    const api = makeApi();
    const oversized = Buffer.alloc(21 * MB, 1);

    await sendWechatAttachments(
      api as any,
      'user-1',
      [
        {
          data: oversized.toString('base64'),
          fetchUrl: 'https://example.com/f/big.zip',
          name: 'big.zip',
          type: 'file',
        },
      ],
      'token-1',
    );

    expect(budgetMocks.compressImageToBudget).not.toHaveBeenCalled();
    expect(api.uploadCdnMedia).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('big.zip'),
      'token-1',
    );
  });

  it('propagates a fallback-link failure so the replay queue keeps the payload', async () => {
    const api = makeApi();
    api.sendMessage.mockRejectedValue(new Error('iLink down'));

    await expect(
      sendWechatAttachments(
        api as any,
        'user-1',
        [
          {
            data: Buffer.alloc(21 * MB, 1).toString('base64'),
            fetchUrl: 'https://example.com/f/big.zip',
            name: 'big.zip',
            type: 'file',
          },
        ],
        'token-1',
      ),
    ).rejects.toThrow('iLink down');
  });

  it('batches several fallback links into one message', async () => {
    const api = makeApi();
    const oversized = Buffer.alloc(21 * MB, 1).toString('base64');

    await sendWechatAttachments(
      api as any,
      'user-1',
      [
        { data: oversized, fetchUrl: 'https://example.com/f/a', name: 'a.zip', type: 'file' },
        { data: oversized, fetchUrl: 'https://example.com/f/b', name: 'b.zip', type: 'file' },
      ],
      'token-1',
    );

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage.mock.calls[0][1]).toContain('a.zip');
    expect(api.sendMessage.mock.calls[0][1]).toContain('b.zip');
  });

  it('skips an over-budget attachment with no fetchUrl instead of uploading it', async () => {
    const api = makeApi();
    budgetMocks.compressImageToBudget.mockResolvedValueOnce(undefined);

    await sendWechatAttachments(
      api as any,
      'user-1',
      [{ data: Buffer.alloc(3 * MB).toString('base64'), name: 'big.png', type: 'image' }],
      'token-1',
    );

    expect(api.uploadCdnMedia).not.toHaveBeenCalled();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
});
