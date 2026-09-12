// @vitest-environment node
import type { SendMessageState } from '@lobechat/builtin-tool-message/delivery';
import { WechatApiClient } from '@lobechat/chat-adapter-wechat';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import superjson from 'superjson';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => ({}) }));
vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: vi.fn().mockImplementation(function () {
    return {
      findById: async () => ({
        applicationId: 'fixture-app',
        credentials: { botId: 'fixture-bot', botToken: 'fixture-token' },
        enabled: true,
        platform: 'wechat',
        settings: {},
      }),
    };
  }),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => null,
}));

const { botMessageRouter } = await import('./botMessage');

describe('botMessage send result transport', () => {
  afterEach(() => vi.restoreAllMocks());

  it('serializes the real WeChat service partial result through the tRPC HTTP handler', async () => {
    const sendText = vi
      .spyOn(WechatApiClient.prototype, 'sendMessage')
      .mockResolvedValue({ ret: 0 });
    vi.spyOn(WechatApiClient.prototype, 'uploadCdnMedia').mockRejectedValue(
      new Error('upload failed'),
    );
    const sendItem = vi.spyOn(WechatApiClient.prototype, 'sendItem').mockResolvedValue({ ret: 0 });
    const input = {
      attachments: [{ data: 'YQ==', type: 'image' }],
      botId: 'fixture-bot',
      channelId: 'fixture',
      content: 'fixture text',
    };

    const response = await fetchRequestHandler({
      createContext: async () => ({ userId: 'fixture-user' }),
      endpoint: '/trpc',
      req: new Request('http://localhost/trpc/sendMessage', {
        body: JSON.stringify(superjson.serialize(input)),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      router: botMessageRouter,
    });

    expect(response.status).toBe(200);
    const envelope = await response.json();
    const result = superjson.deserialize<SendMessageState>(envelope.result.data);
    expect(result).toEqual({
      channelId: 'fixture',
      delivery: {
        attachments: [{ index: 0, reason: 'upload_failed', status: 'failed', type: 'image' }],
        receipt: 'unconfirmed',
        status: 'partial',
        text: { status: 'accepted' },
      },
      platform: 'wechat',
    });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendItem).not.toHaveBeenCalled();
  });
});
