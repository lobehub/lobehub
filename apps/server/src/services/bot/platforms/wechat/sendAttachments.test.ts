// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as PublicUrlFetchModule from '../publicUrlFetch';

// These tests stub `fetch` directly; the SSRF guard in front of it resolves DNS
// for real, which has nothing to do with what they assert. Its own behaviour is
// covered in publicUrlFetch.test.ts.
vi.mock('../publicUrlFetch', async () => ({
  // Spread the real module: a full mock silently drops every export it
  // does not name, so adding one to publicUrlFetch breaks suites that
  // never cared about it.
  ...(await vi.importActual<typeof PublicUrlFetchModule>('../publicUrlFetch')),
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
const { WECHAT_RET_CODES } = await import('@lobechat/chat-adapter-wechat');

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

  it('counts deliveries and carries the loader reason for a lost source', async () => {
    const api = makeApi();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    const result = await sendWechatAttachments(
      api as any,
      'user-1',
      [
        { fetchUrl: 'https://cdn.example.com/gone.docx', name: 'gone.docx', type: 'file' },
        { data: Buffer.from('ok').toString('base64'), name: 'ok.png', type: 'image' },
      ],
      'token-1',
    );

    expect(result.delivered).toBe(1);
    expect(result.failures).toEqual([
      { detail: 'HTTP 403', name: 'gone.docx', reason: 'source-unavailable', type: 'file' },
    ]);
    expect(result.undelivered).toEqual([
      { fetchUrl: 'https://cdn.example.com/gone.docx', name: 'gone.docx', type: 'file' },
    ]);
  });

  it('keeps the local session-expired code in step with the adapter constant', () => {
    // The sender spells the code out so its per-item catch never touches a
    // (possibly mocked) adapter module; this pins the two together.
    expect(WECHAT_RET_CODES.SESSION_EXPIRED).toBe(-14);
  });

  it('names the QR re-login when iLink refuses the upload with session timeout (-14)', async () => {
    const api = makeApi();
    api.uploadCdnMedia.mockRejectedValueOnce(
      Object.assign(
        new Error(
          'getuploadurl returned empty upload_param: {"errcode":-14,"errmsg":"session timeout"}',
        ),
        { code: -14 },
      ),
    );

    const result = await sendWechatAttachments(
      api as any,
      'user-1',
      [{ data: Buffer.from('doc').toString('base64'), name: 'a.docx', type: 'file' }],
      'token-1',
    );

    expect(result.delivered).toBe(0);
    expect(result.failures).toEqual([
      {
        detail: expect.stringContaining('WeChat bot session expired (errcode -14)'),
        name: 'a.docx',
        reason: 'upload-failed',
        type: 'file',
      },
    ]);
    expect(result.failures[0].detail).toContain('session timeout');
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
