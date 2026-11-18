import { beforeEach, describe, expect, it, vi } from 'vitest';

const botReply = vi.hoisted(() => ({
  forgetDingTalkSessionWebhook: vi.fn(),
  getDingTalkSessionWebhook: vi.fn(),
}));
vi.mock('@/server/services/redis', () => ({ redisService: { botReply } }));

const { DingTalkMessageService } = await import('./service');

const createApi = () => ({
  replyViaSessionWebhook: vi.fn().mockResolvedValue(undefined),
  sendGroupMessage: vi.fn().mockResolvedValue({ processQueryKey: 'group-key' }),
  sendSingleMessage: vi.fn().mockResolvedValue({ processQueryKey: 'single-key' }),
});

describe('DingTalkMessageService', () => {
  let api: ReturnType<typeof createApi>;
  let service: InstanceType<typeof DingTalkMessageService>;

  beforeEach(() => {
    vi.clearAllMocks();
    botReply.getDingTalkSessionWebhook.mockResolvedValue(undefined);
    api = createApi();
    service = new DingTalkMessageService(api as any, 'dingapp');
  });

  it.each([
    ['group:cid1==', 'group', 'cid1=='],
    ['dingtalk:group:cid1==', 'group', 'cid1=='],
    ['cid1==', 'group', 'cid1=='],
  ])('sends %s to a group', async (channelId, _type, id) => {
    const result = await service.sendMessage({ channelId, content: 'hello' });

    expect(api.sendGroupMessage).toHaveBeenCalledWith(id, {
      msgKey: 'sampleText',
      msgParam: { content: 'hello' },
    });
    expect(result).toEqual({
      channelId: `dingtalk:group:${id}`,
      messageId: 'group-key',
      platform: 'dingtalk',
    });
  });

  it.each([['single:staff1'], ['dingtalk:single:staff1']])(
    'sends %s to a single chat',
    async (channelId) => {
      const result = await service.sendMessage({ channelId, content: '# Title\nbody' });

      expect(api.sendSingleMessage).toHaveBeenCalledWith(['staff1'], {
        msgKey: 'sampleMarkdown',
        msgParam: { text: '# Title\nbody', title: 'Title' },
      });
      expect(result.messageId).toBe('single-key');
    },
  );

  it('reports attachments that could not be delivered natively', async () => {
    const result = await service.sendMessage({
      attachments: [
        { fetchUrl: 'https://cdn.example/a.png', name: 'a.png', type: 'image' },
        { fetchUrl: 'https://cdn.example/r.pdf', name: 'r.pdf', type: 'file' },
      ],
      channelId: 'group:cid1',
      content: 'see attached',
    });

    expect(result.attachmentsDelivered).toBe(1);
    expect(result.attachmentFailures).toEqual([
      expect.objectContaining({ name: 'r.pdf', reason: 'upload-failed', type: 'file' }),
    ]);
  });
});
