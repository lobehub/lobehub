import type {
  SendMessageDelivery,
  SendMessageState,
} from '@lobechat/builtin-tool-message/delivery';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    agentBotProvider: {
      list: { query: async () => [{ enabled: true, id: 'fixture-bot', platform: 'wechat' }] },
    },
    botMessage: { sendMessage: { mutate: mocks.send } },
  },
}));

const { messageExecutor } = await import('./index');

describe('message executor delivery feedback', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each<SendMessageDelivery['status']>(['accepted', 'degraded', 'partial', 'failed', 'unknown'])(
    'preserves %s across the frontend adapter and shared runtime',
    async (status) => {
      const result: SendMessageState = {
        channelId: 'fixture',
        delivery: {
          attachments:
            status === 'accepted'
              ? []
              : [
                  {
                    index: 0,
                    type: 'image',
                    ...(status === 'degraded'
                      ? ({ reason: 'over_budget', status: 'link_fallback' } as const)
                      : status === 'unknown'
                        ? ({ reason: 'send_unconfirmed', status: 'unknown' } as const)
                        : ({ reason: 'upload_failed', status: 'failed' } as const)),
                  },
                ],
          receipt: 'unconfirmed',
          status,
          text: { status: status === 'failed' ? 'not_requested' : 'accepted' },
        },
        platform: 'wechat',
      };
      mocks.send.mockResolvedValueOnce(result);

      const output = await messageExecutor.sendMessage({
        channelId: 'fixture',
        content: 'fixture text',
        platform: 'wechat',
      });

      expect(output.success).toBe(status === 'accepted');
      expect(output.state).toEqual(result);
      expect(output.content).toContain(JSON.stringify(result.delivery, null, 2));
      expect(mocks.send).toHaveBeenCalledTimes(1);
    },
  );

  it('does not claim success when an older WeChat server omits outcomes', async () => {
    mocks.send.mockResolvedValueOnce({ channelId: 'fixture', platform: 'wechat' });

    const result = await messageExecutor.sendMessage({
      channelId: 'fixture',
      content: 'fixture text',
      platform: 'wechat',
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('did not provide per-item send results');
    expect(result.content).not.toContain('undefined');
  });

  it('retains the existing error path for transport failures', async () => {
    mocks.send.mockRejectedValueOnce(new Error('fixture transport failed'));

    const result = await messageExecutor.sendMessage({
      channelId: 'fixture',
      content: 'fixture text',
      platform: 'wechat',
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('fixture transport failed');
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
