// @vitest-environment node
import type { WechatApiClient } from '@lobechat/chat-adapter-wechat';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AttachmentBudgetModule from '../attachmentBudget';
import type * as PublicUrlFetchModule from '../publicUrlFetch';
import type { WechatOutboundAttachment } from './sendAttachments';

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

vi.mock('../attachmentBudget', async (importOriginal) => {
  const original = await importOriginal<typeof AttachmentBudgetModule>();
  return {
    ...original,
    compressImageToBudget: budgetMocks.compressImageToBudget,
    PLATFORM_ATTACHMENT_BUDGETS: {
      ...original.PLATFORM_ATTACHMENT_BUDGETS,
      wechat: { ...original.PLATFORM_ATTACHMENT_BUDGETS.wechat },
    },
  };
});

const { PLATFORM_ATTACHMENT_BUDGETS } = await import('../attachmentBudget');
const { sendWechatAttachments, WechatAttachmentSendError } = await import('./sendAttachments');
const defaultWechatBudget = { ...PLATFORM_ATTACHMENT_BUDGETS.wechat };

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
    Object.assign(PLATFORM_ATTACHMENT_BUDGETS.wechat, defaultWechatBudget);
  });

  it('uploads an in-budget attachment as-is', async () => {
    const api = makeApi();
    const bytes = Buffer.alloc(1024, 1);

    const result = await sendWechatAttachments(
      api as any,
      'user-1',
      [{ data: bytes.toString('base64'), name: 'a.png', type: 'image' }],
      'token-1',
    );

    expect(budgetMocks.compressImageToBudget).not.toHaveBeenCalled();
    expect(api.uploadCdnMedia).toHaveBeenCalledTimes(1);
    expect(api.sendItem).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([{ index: 0, status: 'accepted', type: 'image' }]);
  });

  it('recompresses an over-budget image before uploading', async () => {
    const api = makeApi();
    const oversized = Buffer.alloc(3 * MB, 1);
    const compressed = Buffer.alloc(1 * MB, 2);
    budgetMocks.compressImageToBudget.mockResolvedValueOnce(compressed);

    const result = await sendWechatAttachments(
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
    expect(result.outcomes).toEqual([{ index: 0, status: 'accepted', type: 'image' }]);
  });

  it('sends a download link when an image cannot be compressed under budget', async () => {
    const api = makeApi();
    const oversized = Buffer.alloc(3 * MB, 1);
    budgetMocks.compressImageToBudget.mockResolvedValueOnce(undefined);

    const result = await sendWechatAttachments(
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
    expect(result.outcomes).toEqual([
      { index: 0, reason: 'over_budget', status: 'link_fallback', type: 'image' },
    ]);
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

    const result = await sendWechatAttachments(
      api as any,
      'user-1',
      [{ data: Buffer.alloc(3 * MB).toString('base64'), name: 'big.png', type: 'image' }],
      'token-1',
    );

    expect(api.uploadCdnMedia).not.toHaveBeenCalled();
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([
      { index: 0, reason: 'over_budget_no_link', status: 'failed', type: 'image' },
    ]);
    expect(result.failures).toEqual([
      { name: 'big.png', reason: 'over-budget-no-link', type: 'image' },
    ]);
  });

  it('retains legacy failure details and original references while later attachments succeed', async () => {
    const api = makeApi();
    const unavailable = { name: 'missing.png', type: 'image' } as const;
    const first = { data: 'YQ==', name: 'same.png', type: 'image' } as const;
    const second = { data: 'Yg==', name: 'same.png', type: 'image' } as const;
    api.uploadCdnMedia.mockRejectedValueOnce(new Error('synthetic upload failure'));

    const result = await sendWechatAttachments(
      api as unknown as WechatApiClient,
      'user-1',
      [unavailable, first, second],
      'token-1',
    );

    expect(result.outcomes).toEqual([
      { index: 0, reason: 'source_unavailable', status: 'failed', type: 'image' },
      { index: 1, reason: 'upload_failed', status: 'failed', type: 'image' },
      { index: 2, status: 'accepted', type: 'image' },
    ]);
    expect(result.undelivered[0]).toBe(unavailable);
    expect(result.undelivered[1]).toBe(first);
    expect(result.failures).toEqual([
      { name: 'missing.png', reason: 'source-unavailable', type: 'image' },
      {
        detail: 'synthetic upload failure',
        name: 'same.png',
        reason: 'upload-failed',
        type: 'image',
      },
    ]);
    expect(api.sendItem).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a failed preparation from an uncertain media submission', async () => {
    const api = makeApi();
    PLATFORM_ATTACHMENT_BUDGETS.wechat.imageMaxBytes = 2;
    budgetMocks.compressImageToBudget.mockRejectedValueOnce(new Error('prepare failed'));
    api.sendItem.mockRejectedValueOnce(new Error('response lost'));

    const result = await sendWechatAttachments(
      api as unknown as WechatApiClient,
      'user-1',
      [
        { data: Buffer.from('big').toString('base64'), type: 'image' },
        { data: 'YQ==', type: 'image' },
        { data: 'Yg==', type: 'image' },
      ],
      'token-1',
    );

    expect(result.outcomes).toEqual([
      { index: 0, reason: 'prepare_failed', status: 'failed', type: 'image' },
      { index: 1, reason: 'send_unconfirmed', status: 'unknown', type: 'image' },
      { index: 2, status: 'accepted', type: 'image' },
    ]);
    expect(api.sendItem).toHaveBeenCalledTimes(2);
  });

  it('keeps separate outcomes for repeated objects and matching source URLs', async () => {
    const api = makeApi();
    const attachment = {
      data: 'YQ==',
      fetchUrl: 'https://example.com/same',
      type: 'file',
    } as const;
    api.uploadCdnMedia.mockResolvedValueOnce({
      aesKey: 'key',
      cipherSize: 16,
      encryptQueryParam: 'p',
      rawSize: 1,
    });
    api.uploadCdnMedia.mockRejectedValueOnce(new Error('second upload failed'));

    const result = await sendWechatAttachments(
      api as unknown as WechatApiClient,
      'user-1',
      [attachment, attachment, { ...attachment }],
      'token-1',
    );

    expect(result.outcomes).toEqual([
      { index: 0, status: 'accepted', type: 'file' },
      { index: 1, reason: 'upload_failed', status: 'failed', type: 'file' },
      { index: 2, status: 'accepted', type: 'file' },
    ]);
    expect(result.undelivered).toHaveLength(1);
    expect(result.undelivered[0]).toBe(attachment);
  });

  it('marks every link in a successful batch as fallback without adding sends', async () => {
    const api = makeApi();
    PLATFORM_ATTACHMENT_BUDGETS.wechat.fileMaxBytes = 2;
    const attachments: WechatOutboundAttachment[] = ['a', 'b'].map((name) => ({
      data: Buffer.from('big').toString('base64'),
      fetchUrl: `https://example.com/${name}`,
      name,
      type: 'file',
    }));

    const result = await sendWechatAttachments(
      api as unknown as WechatApiClient,
      'user-1',
      attachments,
      'token-1',
    );

    expect(result.outcomes).toEqual([
      { index: 0, reason: 'over_budget', status: 'link_fallback', type: 'file' },
      { index: 1, reason: 'over_budget', status: 'link_fallback', type: 'file' },
    ]);
    expect(result.failures).toEqual([]);
    expect(result.undelivered).toEqual([]);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('preserves accepted media and links when a later link batch rejects', async () => {
    const api = makeApi();
    Object.assign(PLATFORM_ATTACHMENT_BUDGETS.wechat, { fileMaxBytes: 2, textMaxChars: 1 });
    api.sendMessage.mockResolvedValueOnce({});
    api.sendMessage.mockRejectedValueOnce(new Error('iLink down'));
    const links: WechatOutboundAttachment[] = ['a', 'b', 'c'].map((name) => ({
      data: Buffer.from('big').toString('base64'),
      fetchUrl: `https://example.com/${name}`,
      name,
      type: 'file',
    }));

    const error = await sendWechatAttachments(
      api as unknown as WechatApiClient,
      'user-1',
      [{ data: 'YQ==', type: 'image' }, ...links],
      'token-1',
    ).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(WechatAttachmentSendError);
    const failure = error as InstanceType<typeof WechatAttachmentSendError>;
    expect(failure.message).toBe('iLink down');
    expect(failure.result.outcomes).toEqual([
      { index: 0, status: 'accepted', type: 'image' },
      { index: 1, reason: 'over_budget', status: 'link_fallback', type: 'file' },
      { index: 2, reason: 'link_send_unconfirmed', status: 'unknown', type: 'file' },
      { index: 3, reason: 'prior_failure', status: 'not_attempted', type: 'file' },
    ]);
    expect(api.sendItem).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });
});
