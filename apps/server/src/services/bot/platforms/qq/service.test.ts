import type { QQApiClient } from '@lobechat/chat-adapter-qq';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@lobechat/chat-adapter-qq', () => ({
  createQQAdapter: vi.fn(),
  QQApiClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: {
    connected: 'connected',
    disconnected: 'disconnected',
    failed: 'failed',
    starting: 'starting',
  },
  getRuntimeStatusErrorMessage: (e: any) => String(e?.message ?? e),
  updateBotRuntimeStatus: vi.fn().mockResolvedValue(undefined),
}));

const { resolveCurrentChannel } = await import('@/server/services/bot/AgentBridgeService/utils');
const { QQClientFactory } = await import('./client');
const { parseChannelId, QQMessageService } = await import('./service');

const OPENID = '84DAB623CF2C9633F683CAF4BF7ED548';
const GROUP_NOT_FOUND = new Error(
  `QQ API POST /v2/groups/${OPENID}/messages failed: 400 {"message":"请求的资源不存在(用户/群已注销)","code":11255}`,
);

const createApi = () =>
  ({
    sendC2CMessage: vi.fn().mockResolvedValue({ id: 'c2c-msg' }),
    sendDmsMessage: vi.fn().mockResolvedValue({ id: 'dms-msg' }),
    sendGroupMessage: vi.fn().mockResolvedValue({ id: 'group-msg' }),
    sendGuildMessage: vi.fn().mockResolvedValue({ id: 'guild-msg' }),
  }) as unknown as QQApiClient & Record<string, ReturnType<typeof vi.fn>>;

const createClient = (connectionMode: 'webhook' | 'websocket') =>
  new QQClientFactory().createClient(
    {
      applicationId: 'qq-app',
      credentials: { appSecret: 'sec' },
      platform: 'qq',
      settings: { connectionMode },
    },
    { appUrl: 'https://example.com' },
  );

/** The channelId the agent is told to use for the conversation `platformThreadId` denotes. */
const currentChannelId = (platformThreadId: string, connectionMode: 'webhook' | 'websocket') =>
  resolveCurrentChannel(
    { applicationId: 'qq-app', platform: 'qq', platformThreadId } as any,
    createClient(connectionMode),
  )?.id;

describe('QQ active sendMessage to the current conversation', () => {
  it.each(['websocket', 'webhook'] as const)(
    'delivers a c2c conversation through the c2c endpoint (%s)',
    async (mode) => {
      const channelId = currentChannelId(`qq:c2c:${OPENID}`, mode)!;
      expect(channelId).toBe(`c2c:${OPENID}`);

      const api = createApi();
      const result = await new QQMessageService(api).sendMessage({
        channelId,
        content: 'report attached',
        platform: 'qq',
      } as any);

      expect(api.sendC2CMessage).toHaveBeenCalledWith(OPENID, 'report attached');
      expect(api.sendGroupMessage).not.toHaveBeenCalled();
      expect(result).toEqual({ channelId, messageId: 'c2c-msg', platform: 'qq' });
    },
  );

  it.each(['websocket', 'webhook'] as const)(
    'delivers a group conversation through the group endpoint (%s)',
    async (mode) => {
      const channelId = currentChannelId(`qq:group:${OPENID}`, mode)!;
      expect(channelId).toBe(`group:${OPENID}`);

      const api = createApi();
      await new QQMessageService(api).sendMessage({
        channelId,
        content: 'hi group',
        platform: 'qq',
      } as any);

      expect(api.sendGroupMessage).toHaveBeenCalledWith(OPENID, 'hi group');
      expect(api.sendC2CMessage).not.toHaveBeenCalled();
    },
  );

  it('explains a type mismatch instead of surfacing "群已注销" for an unprefixed id', async () => {
    const api = createApi();
    api.sendGroupMessage.mockRejectedValue(GROUP_NOT_FOUND);

    const send = new QQMessageService(api).sendMessage({
      channelId: OPENID,
      content: 'hi',
      platform: 'qq',
    } as any);

    await expect(send).rejects.toThrow(/no conversation-type prefix/);
    await expect(send).rejects.toThrow(`"c2c:${OPENID}"`);
  });

  it('keeps the QQ error as-is when the group type was explicit', async () => {
    const api = createApi();
    api.sendGroupMessage.mockRejectedValue(GROUP_NOT_FOUND);

    await expect(
      new QQMessageService(api).sendMessage({
        channelId: `group:${OPENID}`,
        content: 'hi',
        platform: 'qq',
      } as any),
    ).rejects.toBe(GROUP_NOT_FOUND);
  });
});

describe('parseChannelId', () => {
  it.each([
    [`c2c:${OPENID}`, 'c2c', OPENID, false],
    [`qq:c2c:${OPENID}`, 'c2c', OPENID, false],
    ['group:g1', 'group', 'g1', false],
    ['guild:chan1:guild1', 'guild', 'chan1', false],
    ['dms:guild1', 'dms', 'guild1', false],
    [OPENID, 'group', OPENID, true],
  ])('%s → %s / %s', (channelId, threadType, targetId, typeInferred) => {
    expect(parseChannelId(channelId)).toEqual({ targetId, threadType, typeInferred });
  });
});
